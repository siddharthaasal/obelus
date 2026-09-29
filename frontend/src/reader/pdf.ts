// The legacy build: pdf.js's modern build calls Math.sumPrecise when it converts embedded fonts,
// which current Chrome doesn't have, so books fell back to substitute fonts. Legacy polyfills it.
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'

/** A table of contents entry, with the page its destination points to. */
export type OutlineItem = {
  title: string
  page: number | null
  dest: string | unknown[] | null
  items: OutlineItem[]
}

export type DocumentInfo = {
  pageCount: number
  /** Printed page labels ("iv", "12"), when the PDF defines them. */
  labels: string[] | null
  outline: OutlineItem[]
}

/** 'auto' fits the page width up to 125%. The others are pdf.js's presets, or a factor. */
export type ScaleValue = 'auto' | 'page-width' | 'page-fit' | number

type Callbacks = {
  onReady: (info: DocumentInfo) => void
  onPage: (page: number) => void
  onScale: (scale: number, value: ScaleValue) => void
  onError: (error: Error) => void
}

const PRESETS = new Set(['auto', 'page-width', 'page-fit'])

// pdf_viewer.mjs reads the core library from globalThis.pdfjsLib as it loads, so load them in
// order, once.
let modules: Promise<{
  lib: typeof import('pdfjs-dist/legacy/build/pdf.mjs')
  viewer: typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
}> | null = null

function loadPdfjs() {
  modules ??= (async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    lib.GlobalWorkerOptions.workerSrc = workerUrl
    ;(globalThis as { pdfjsLib?: unknown }).pdfjsLib = lib
    const viewer = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
    return { lib, viewer }
  })()
  return modules
}

/**
 * A pdf.js viewer in `host`: continuous scroll, text layer on (so selections match what's on
 * screen), links in the PDF clickable, forms and annotation editing off.
 */
export class PdfReader {
  #callbacks: Callbacks
  #container: HTMLDivElement
  #viewer: PDFViewer | null = null
  #links: PDFLinkService | null = null
  #task: PDFDocumentLoadingTask | null = null
  #resize: ResizeObserver | null = null
  #positioned = false
  #destroyed = false

  constructor(host: HTMLElement, callbacks: Callbacks) {
    this.#callbacks = callbacks
    // Fresh elements per reader, so a destroyed viewer's listeners go with its DOM.
    this.#container = document.createElement('div')
    this.#container.className = 'reader-viewer'
    this.#container.tabIndex = 0
    const pages = document.createElement('div')
    pages.className = 'pdfViewer'
    this.#container.append(pages)
    host.append(this.#container)
  }

  get container() {
    return this.#container
  }

  async open(url: string, { page, scale }: { page: number; scale: ScaleValue }) {
    try {
      const { lib, viewer: v } = await loadPdfjs()
      if (this.#destroyed) return

      const eventBus = new v.EventBus()
      const linkService = new v.PDFLinkService({
        eventBus,
        externalLinkTarget: v.LinkTarget.BLANK,
        externalLinkRel: 'noopener noreferrer',
      })
      const viewer = new v.PDFViewer({
        container: this.#container,
        viewer: this.#container.firstElementChild as HTMLDivElement,
        eventBus,
        linkService,
        // Keep pdf.js's transparent page borders: fit-to-width leaves room for them, so pages
        // get side gutters. reader.css draws the visible frame.
        textLayerMode: 1,
        annotationMode: lib.AnnotationMode.ENABLE,
        annotationEditorMode: lib.AnnotationEditorType.DISABLE,
      })
      linkService.setViewer(viewer)
      this.#viewer = viewer
      this.#links = linkService

      eventBus.on('pagesinit', () => {
        viewer.currentScaleValue = String(scale)
        if (page > 1) viewer.currentPageNumber = Math.min(page, viewer.pagesCount)
        // Report pages only from here, so the brief stop at page 1 never counts as a position.
        this.#positioned = true
        this.#callbacks.onPage(viewer.currentPageNumber)
      })
      eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
        if (this.#positioned) this.#callbacks.onPage(pageNumber)
      })
      eventBus.on('scalechanging', ({ scale: s, presetValue }: { scale: number; presetValue?: string }) =>
        this.#callbacks.onScale(s, presetValue && PRESETS.has(presetValue) ? (presetValue as ScaleValue) : s),
      )

      this.#task = lib.getDocument({
        url,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
        iccUrl: '/pdfjs/iccs/',
      })
      const doc = await this.#task.promise
      if (this.#destroyed) return
      viewer.setDocument(doc)
      linkService.setDocument(doc)

      // Presets depend on the container's width, which changes as panels open and close.
      let frame = 0
      this.#resize = new ResizeObserver(() => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          // Reassigning a preset recomputes it for the new width.
          const value = viewer.currentScaleValue
          if (PRESETS.has(value)) viewer.currentScaleValue = value
        })
      })
      this.#resize.observe(this.#container)

      const [outline, labels] = await Promise.all([doc.getOutline(), doc.getPageLabels()])
      const info = { pageCount: doc.numPages, labels, outline: await resolveOutline(doc, outline ?? []) }
      if (!this.#destroyed) this.#callbacks.onReady(info)
    } catch (e) {
      if (!this.#destroyed) this.#callbacks.onError(e as Error)
    }
  }

  goToPage(page: number) {
    if (this.#viewer?.pdfDocument) this.#viewer.currentPageNumber = page
  }

  nextPage() {
    this.#viewer?.nextPage()
  }

  previousPage() {
    this.#viewer?.previousPage()
  }

  goToDestination(dest: string | unknown[]) {
    this.#links?.goToDestination(dest as string)
  }

  setScale(value: ScaleValue) {
    if (this.#viewer?.pdfDocument) this.#viewer.currentScaleValue = String(value)
  }

  zoom(steps: number) {
    if (!this.#viewer?.pdfDocument) return
    if (steps > 0) this.#viewer.increaseScale({ steps })
    else this.#viewer.decreaseScale({ steps: -steps })
  }

  destroy() {
    this.#destroyed = true
    this.#resize?.disconnect()
    this.#task?.destroy()
    this.#container.remove()
  }
}

type RawOutline = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>

async function resolveOutline(doc: PDFDocumentProxy, items: RawOutline): Promise<OutlineItem[]> {
  return Promise.all(
    items.map(async (item) => ({
      title: item.title,
      dest: item.dest,
      page: await destinationPage(doc, item.dest),
      items: await resolveOutline(doc, item.items ?? []),
    })),
  )
}

/** The page a destination points to, or null if it can't be resolved. */
async function destinationPage(doc: PDFDocumentProxy, dest: string | unknown[] | null) {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const [ref] = explicit
    const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref)
    return index + 1
  } catch {
    return null
  }
}
