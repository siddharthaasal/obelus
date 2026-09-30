import type { Book } from '../../api'
import type { CoverLook } from '../cover'

/** Front-to-back depth of every book, which is also the width of its front cover. */
export const DEPTH = 170
/** How far a hovered book slides out towards you, and how far it rises. */
export const PULL = 96
export const LIFT = -26
/** Space between neighbouring spines. */
export const GAP = 3
/** Books at the edges of the shelf turn this far; the middle stays flat. */
export const MAX_TURN = 34
export const PERSPECTIVE = 1400

const DEFAULT_ASPECT = 2 / 3

/** Thicker books get wider spines. */
export function spineWidth(book: Book): number {
  const pages = book.page_count ?? 250
  return Math.round(Math.min(60, Math.max(22, 14 + pages * 0.06)))
}

/** The spine is as tall as the cover, which is DEPTH wide at the first page's proportions. */
export function spineHeight(look: CoverLook | null | undefined): number {
  return Math.round(Math.min(290, Math.max(200, DEPTH / (look?.aspect ?? DEFAULT_ASPECT))))
}

/** How far a book at `t` (-1 at the left edge, 1 at the right, 0 in the middle) turns. */
export const turnAt = (t: number) => {
  const d = Math.min(1, Math.abs(t))
  return -Math.sign(t) * MAX_TURN * d ** 1.35
}
