import type { HighlightColor, PageRect } from '../api'

/** What the viewer needs to draw a highlight. */
export type DrawnHighlight = { id: number; page_number: number; rects: PageRect[]; color: HighlightColor }

// Boxes on one line closer than this (in line heights) are joined into one.
const JOIN_GAP = 0.6
// The text layer's end-of-content marker and line breaks produce boxes much taller than text.
const MAX_HEIGHT_RATIO = 2.5

/**
 * Where a selection sits on its page, as boxes in fractions of the page's size: one per line
 * of text, so they draw the same at any zoom. Parts of the selection on other pages are left
 * out.
 */
export function selectionRects(range: Range, pageEl: HTMLElement): PageRect[] {
  const page = contentBox(pageEl)
  const boxes = [...range.getClientRects()]
    .map((r) => intersect(r, page))
    .filter((r): r is DOMRect => r !== null && r.width > 0.5 && r.height > 0.5)
  if (boxes.length === 0) return []
  const heights = boxes.map((b) => b.height).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)]
  const lines: DOMRect[] = []
  for (const b of boxes.filter((b) => b.height <= median * MAX_HEIGHT_RATIO).sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find((l) => sameLine(l, b))
    if (line && b.left - line.right < JOIN_GAP * b.height && line.left - b.right < JOIN_GAP * b.height) {
      lines[lines.indexOf(line)] = union(line, b)
    } else {
      lines.push(b)
    }
  }
  return lines.map((l) => ({
    x: (l.left - page.left) / page.width,
    y: (l.top - page.top) / page.height,
    w: l.width / page.width,
    h: l.height / page.height,
  }))
}

/**
 * Draw a page's highlights, below its text so selecting still works. pdf.js clears a page's
 * extra layers when it re-renders it, so this runs again after every render.
 */
export function drawHighlights(pageEl: HTMLElement, highlights: DrawnHighlight[], flashing: number | null) {
  let layer = pageEl.querySelector<HTMLDivElement>(':scope > .highlight-layer')
  if (highlights.length === 0) {
    layer?.remove()
    return
  }
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'highlight-layer'
    const canvas = pageEl.querySelector(':scope > .canvasWrapper')
    if (canvas) canvas.after(layer)
    else pageEl.prepend(layer)
  }
  layer.replaceChildren(
    ...highlights.flatMap((h) =>
      h.rects.map((r) => {
        const el = document.createElement('div')
        el.className = `highlight highlight-${h.color}${h.id === flashing ? ' is-flashing' : ''}`
        el.dataset.id = String(h.id)
        el.style.left = `${r.x * 100}%`
        el.style.top = `${r.y * 100}%`
        el.style.width = `${r.w * 100}%`
        el.style.height = `${r.h * 100}%`
        return el
      }),
    ),
  )
}

/** The highlight under a point on the page, the most recent if they overlap. */
export function highlightAt<T extends DrawnHighlight>(pageEl: HTMLElement, x: number, y: number, highlights: T[]) {
  const page = contentBox(pageEl)
  const px = (x - page.left) / page.width
  const py = (y - page.top) / page.height
  const inside = (r: PageRect) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
  return highlights.findLast((h) => h.rects.some(inside)) ?? null
}

/** The page's drawing area on screen: its box inside the transparent border pdf.js gives it. */
export function contentBox(pageEl: HTMLElement): DOMRect {
  const r = pageEl.getBoundingClientRect()
  return new DOMRect(r.left + pageEl.clientLeft, r.top + pageEl.clientTop, pageEl.clientWidth, pageEl.clientHeight)
}

function sameLine(a: DOMRect, b: DOMRect) {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return overlap > 0.5 * Math.min(a.height, b.height)
}

function union(a: DOMRect, b: DOMRect) {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top)
}

function intersect(a: DOMRect, b: DOMRect): DOMRect | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null
}
