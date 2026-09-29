import type { LookupKind } from '../api'

/** Text selected in a page's text layer, with what the backend needs to anchor it. */
export type ReaderSelection = {
  /** As selected, line breaks included: the backend rejoins words hyphenated across lines. */
  raw: string
  /** On one line, for display. */
  text: string
  /** The PDF page the selection starts on. */
  page: number
  /** Text layer text just before and after the selection, to tell repeated words apart. */
  before: string
  after: string
  range: Range
  /** The scrolling viewer it's in. */
  viewer: HTMLElement
}

const CONTEXT_CHARS = 120
// Longer selections are passages: they can be explained, not defined or looked up as a name.
const TERM_MAX_CHARS = 100
const TERM_MAX_WORDS = 8

/** The current selection, if it's text inside one of the viewer's pages. */
export function readSelection(container: HTMLElement): ReaderSelection | null {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const pageEl = closestPage(range.startContainer)
  const layer = pageEl?.querySelector('.textLayer')
  const page = Number(pageEl?.dataset.pageNumber)
  if (!pageEl || !layer || !page) return null

  // Selection.toString() turns the text layer's line breaks into newlines; Range's doesn't.
  const raw = selection.toString().trim()
  const text = oneLine(raw)
  if (!text) return null

  const before = document.createRange()
  before.setStart(layer, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.setStart(range.endContainer, range.endOffset)
  after.setEnd(layer, layer.childNodes.length) // collapses if the selection ends on a later page
  return {
    raw,
    text,
    page,
    before: before.toString().slice(-CONTEXT_CHARS),
    after: after.toString().slice(0, CONTEXT_CHARS),
    range,
    viewer: container,
  }
}

/**
 * Report the viewer's selection as it changes: null while a drag is in progress (so the
 * popover doesn't chase the pointer), the selection once it's let go.
 */
export function trackSelection(container: HTMLElement, onChange: (s: ReaderSelection | null) => void) {
  let dragging = false
  let timer = 0
  const update = () => onChange(readSelection(container))
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    dragging = true
    onChange(null)
  }
  const onUp = () => {
    if (!dragging) return
    dragging = false
    clearTimeout(timer)
    timer = window.setTimeout(update)
  }
  // Keyboard selection, and selections cleared by clicking elsewhere.
  const onSelectionChange = () => {
    if (dragging) return
    clearTimeout(timer)
    timer = window.setTimeout(update, 150)
  }
  container.addEventListener('pointerdown', onDown)
  window.addEventListener('pointerup', onUp)
  document.addEventListener('selectionchange', onSelectionChange)
  return () => {
    clearTimeout(timer)
    container.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointerup', onUp)
    document.removeEventListener('selectionchange', onSelectionChange)
  }
}

/** Which actions a selection offers: short ones are terms or names, long ones passages. */
export function actionsFor(selection: ReaderSelection): LookupKind[] {
  const words = selection.text.split(' ').length
  const short = selection.text.length <= TERM_MAX_CHARS && words <= TERM_MAX_WORDS
  return short ? ['define', 'who', 'explain'] : ['explain']
}

/** A selection as the lookup will name it: one line, no surrounding punctuation. */
export function displayQuery(kind: LookupKind, selection: ReaderSelection): string {
  if (kind === 'explain') return selection.text
  return selection.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/u, '')
}

function closestPage(node: Node): HTMLElement | null {
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest<HTMLElement>('.page[data-page-number]') ?? null
}

function oneLine(text: string): string {
  return text
    .replace(/(\p{L})[-­]\s*\n\s*(?=\p{Ll})/gu, '$1') // philo-\nsophy -> philosophy
    .replace(/\s+/g, ' ')
    .trim()
}
