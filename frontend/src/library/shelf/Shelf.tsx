import { type CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Book } from '../../api'
import { cx, Kbd, StatusIcon } from '../../ui'
import type { BookHandlers } from '../BookActions'
import { useCoverLook } from '../cover'
import { progressLabel, STATUS } from '../status'
import Book3D from './Book3D'
import { GAP, LIFT, PERSPECTIVE, PULL, spineHeight, spineWidth, turnAt } from './geometry'
import ShelfDetail, { type Phase, type SlotPose } from './ShelfDetail'
import './shelf.css'

type Props = {
  books: Book[]
  uploading: number
  /** A book that has just been added. It slides onto the shelf and the shelf turns to it. */
  arriving: number | null
  handlers: (book: Book) => BookHandlers
}

type Opened = { id: number; pose: SlotPose; phase: Phase; retract: boolean; swapped: boolean }

// The row repeats three times once it's wider than the rail, and the view stays on the middle
// copy, so the shelf scrolls forever. It only loops when a spine's worth wider, so no book can
// show twice at once.
const LOOP_MARGIN = 80
const LEAVE_GRACE_MS = 90
const RETRACT_MS = 620
const GLIDE_MS = 420
const ARROW_STEP = 320

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The library as books on a shelf. Scroll, drag, or use the arrow keys to browse; hover a book
 * to pull it out a little; click it to take it off the shelf and see its cover.
 */
export default function Shelf({ books, uploading, arriving, handlers }: Props) {
  const rail = useRef<HTMLDivElement>(null)
  const [railWidth, setRailWidth] = useState(0)
  const segment = useMemo(() => books.reduce((sum, b) => sum + spineWidth(b) + GAP, 0), [books])
  const loop = railWidth > 0 && segment > railWidth + LOOP_MARGIN
  const overflowing = railWidth > 0 && segment > railWidth
  const copies = loop ? 3 : 1
  const loopRef = useRef(loop)

  const drag = useRef<{ x: number; left: number; moved: boolean; pointer: number } | null>(null)
  const justDragged = useRef(false)
  const [dragging, setDragging] = useState(false)
  const glide = useRef<{ from: number; to: number; start: number } | null>(null)

  const [hover, setHover] = useState<{ book: Book; rect: DOMRect } | null>(null)
  const hoverRef = useRef(hover)
  const leaveTimer = useRef<number>(undefined)
  const [opened, setOpened] = useState<Opened | null>(null)
  const openedRef = useRef(opened)
  const closeTimer = useRef<number>(undefined)
  /** The book to focus once the open one is back on the shelf and the page is no longer inert. */
  const refocus = useRef<number | null>(null)

  const booksRef = useRef(books)
  useEffect(() => {
    loopRef.current = loop
    hoverRef.current = hover
    booksRef.current = books
    openedRef.current = opened
  })

  /** Keep the view on the middle copy, then turn each book by its distance from the middle. */
  const update = useCallback(() => {
    const el = rail.current
    if (!el) return
    const half = el.clientWidth / 2
    if (loopRef.current) {
      const third = el.scrollWidth / 3
      const middle = el.scrollLeft + half
      const shift = middle < third ? third : middle > 2 * third ? -third : 0
      if (shift) {
        el.scrollLeft += shift
        if (glide.current) {
          glide.current.from += shift
          glide.current.to += shift
        }
        if (drag.current) drag.current.left += shift
      }
    }
    const middle = el.scrollLeft + half
    for (const slot of el.querySelectorAll<HTMLElement>('.shelf-slot')) {
      const t = (slot.offsetLeft + slot.offsetWidth / 2 - middle) / half
      slot.style.setProperty('--turn', `${turnAt(t).toFixed(2)}deg`)
      // Every book is seen from the middle of the rail.
      slot.style.setProperty('--eye', `${(middle - slot.offsetLeft).toFixed(1)}px`)
      // Books nearer the middle stand in front of their neighbours' sides.
      slot.style.zIndex = String(1000 - Math.round(Math.min(2, Math.abs(t)) * 400))
    }
  }, [])

  const glideTo = useCallback((target: number) => {
    const el = rail.current
    if (!el) return
    if (reducedMotion()) {
      el.scrollLeft = target
      return
    }
    const running = glide.current
    glide.current = { from: el.scrollLeft, to: target, start: performance.now() }
    if (running) return
    const step = (now: number) => {
      const g = glide.current
      if (!g || !rail.current) return
      const p = Math.min(1, (now - g.start) / GLIDE_MS)
      rail.current.scrollLeft = g.from + (g.to - g.from) * (1 - (1 - p) ** 3)
      if (p < 1) requestAnimationFrame(step)
      else glide.current = null
    }
    requestAnimationFrame(step)
  }, [])

  const glideBy = useCallback(
    (dx: number) => {
      const el = rail.current
      if (el) glideTo((glide.current?.to ?? el.scrollLeft) + dx)
    },
    [glideTo],
  )

  /** Scroll so a slot sits in the middle of the rail. */
  const centre = useCallback(
    (slot: HTMLElement, { smooth = true, widthAfter = slot.offsetWidth } = {}) => {
      const el = rail.current
      if (!el) return
      const target = slot.offsetLeft + widthAfter / 2 - el.clientWidth / 2
      if (smooth) glideTo(target)
      else {
        glide.current = null
        el.scrollLeft = target
        update()
      }
    },
    [glideTo, update],
  )

  /** The copy of a book nearest the middle of the rail. */
  const locate = useCallback((id: number) => {
    const el = rail.current
    if (!el) return null
    const middle = el.scrollLeft + el.clientWidth / 2
    let best: HTMLElement | null = null
    for (const slot of el.querySelectorAll<HTMLElement>(`.shelf-slot[data-book="${id}"]`)) {
      const d = Math.abs(slot.offsetLeft + slot.offsetWidth / 2 - middle)
      if (!best || d < Math.abs(best.offsetLeft + best.offsetWidth / 2 - middle)) best = slot
    }
    return best
  }, [])

  // Measure the rail, and start in the middle copy when the shelf starts looping.
  useLayoutEffect(() => {
    const el = rail.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setRailWidth(el.clientWidth)
      update()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [update])

  useLayoutEffect(() => {
    const el = rail.current
    if (!el) return
    loopRef.current = loop
    el.scrollLeft = loop ? el.scrollWidth / 3 - el.clientWidth * 0.08 : 0
    update()
  }, [loop, update])

  // Books come and go, covers change the heights: turn everything to match.
  useLayoutEffect(update)

  useEffect(() => {
    const el = rail.current
    if (!el) return
    const onScroll = () => {
      update()
      if (hoverRef.current) setHover(null)
    }
    // A vertical wheel moves along the shelf. Notched wheels glide; trackpads follow the finger.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      if (Math.abs(dy) >= 40) glideBy(dy)
      else {
        glide.current = null
        el.scrollLeft += dy
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
    }
  }, [glideBy, update])

  // Arrow keys browse, unless something else has the keyboard. An open book has its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openedRef.current || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable], dialog')) return
      if (!rail.current || rail.current.scrollWidth <= rail.current.clientWidth) return
      e.preventDefault()
      glideBy(e.key === 'ArrowLeft' ? -ARROW_STEP : ARROW_STEP)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [glideBy])

  // A new book: turn the shelf to it while it slides into place.
  useEffect(() => {
    if (arriving === null) return
    const slot = locate(arriving)
    const book = booksRef.current.find((b) => b.id === arriving)
    if (!slot || !book) return
    // Every copy of the new book is opening its gap, so the ones before this slot push it along.
    const width = spineWidth(book)
    const copy = Number(slot.dataset.copy)
    const el = rail.current
    if (!el) return
    glideTo(slot.offsetLeft + copy * (width + GAP) + width / 2 - el.clientWidth / 2)
  }, [arriving, glideTo, locate])

  useEffect(
    () => () => {
      window.clearTimeout(leaveTimer.current)
      window.clearTimeout(closeTimer.current)
    },
    [],
  )

  const onHover = useCallback((book: Book | null, slot?: HTMLElement) => {
    window.clearTimeout(leaveTimer.current)
    if (book && slot) {
      if (drag.current?.moved) return
      setHover({ book, rect: slot.getBoundingClientRect() })
    } else {
      // A moment's grace, so the card doesn't flicker between neighbouring books.
      leaveTimer.current = window.setTimeout(() => setHover(null), LEAVE_GRACE_MS)
    }
  }, [])

  const onOpen = useCallback((id: number, slot: HTMLElement) => {
    if (justDragged.current) return
    window.clearTimeout(leaveTimer.current)
    window.clearTimeout(closeTimer.current)
    setHover(null)
    setOpened({ id, pose: poseOf(slot), phase: 'opening', retract: true, swapped: false })
  }, [])

  const onFocusSlot = useCallback(
    (slot: HTMLElement) => {
      // Tabbing along the shelf keeps the focused book in the middle.
      if (slot.matches(':focus-visible')) centre(slot)
    },
    [centre],
  )

  const close = useCallback(
    ({ retract = true } = {}) => {
      if (!opened || opened.phase === 'closing') return
      const slot = locate(opened.id)
      setOpened({ ...opened, pose: slot ? poseOf(slot) : opened.pose, phase: 'closing', retract })
      window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(
        () => {
          refocus.current = opened.id
          setOpened(null)
        },
        !retract || reducedMotion() ? 180 : RETRACT_MS,
      )
    },
    [locate, opened],
  )

  useEffect(() => {
    if (opened || refocus.current === null) return
    locate(refocus.current)?.focus({ preventScroll: true })
    refocus.current = null
  }, [opened, locate])

  const step = useCallback(
    (delta: number) => {
      if (!opened || opened.phase === 'closing') return
      const index = books.findIndex((b) => b.id === opened.id)
      const next = books[(index + delta + books.length) % books.length]
      const slot = next && locate(next.id)
      if (!slot || next.id === opened.id) return
      // Behind the blur, bring the next book to the middle so it has somewhere to go back to.
      centre(slot, { smooth: false })
      setOpened({ id: next.id, pose: poseOf(slot), phase: 'open', retract: true, swapped: true })
    },
    [books, centre, locate, opened],
  )

  const onShown = useCallback(
    () => setOpened((o) => (o && o.phase === 'opening' ? { ...o, phase: 'open' } : o)),
    [],
  )

  // Gone if the open book was removed from under it.
  const openBook = opened && books.find((b) => b.id === opened.id)

  const middleCopy = copies === 3 ? 1 : 0

  return (
    <section className="shelf" aria-label="Bookshelf">
      <div
        ref={rail}
        className={cx(
          'shelf-rail',
          overflowing && 'is-overflowing',
          loop && 'is-looping',
          dragging && 'is-dragging',
        )}
        style={
          {
            '--pull-out': `${PULL}px`,
            '--lift-out': `${LIFT}px`,
            '--gap': `${GAP}px`,
            '--perspective': `${PERSPECTIVE}px`,
          } as CSSProperties
        }
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse' || e.button !== 0 || !overflowing) return
          glide.current = null
          drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false, pointer: e.pointerId }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (!d.moved) {
            if (Math.abs(dx) < 4) return
            d.moved = true
            e.currentTarget.setPointerCapture(d.pointer)
            setDragging(true)
            setHover(null)
          }
          e.currentTarget.scrollLeft = d.left - dx
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="shelf-row">
          {Array.from({ length: copies }, (_, copy) =>
            books.map((book) => (
              <ShelfSlot
                key={`${copy}-${book.id}`}
                book={book}
                copy={copy}
                focusable={copy === middleCopy}
                out={openBook?.id === book.id}
                arriving={arriving === book.id}
                onOpen={onOpen}
                onHover={onHover}
                onFocusSlot={onFocusSlot}
              />
            )),
          )}
        </div>
      </div>
      <div className="shelf-ledge" aria-hidden />

      <p className="shelf-hint">
        {uploading > 0 ? (
          <>
            <StatusIcon state="progress" progress={0.25} />
            Adding {uploading} file{uploading > 1 ? 's' : ''}…
          </>
        ) : (
          <>
            Click a book to take it off the shelf
            {overflowing && (
              <>
                <span aria-hidden>·</span>
                Scroll or drag to browse
                <span className="shelf-hint-keys">
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                </span>
              </>
            )}
          </>
        )}
      </p>

      {hover && !openBook && <HoverCard book={hover.book} rect={hover.rect} />}

      {opened && openBook && (
        <ShelfDetail
          book={openBook}
          pose={opened.pose}
          phase={opened.phase}
          retract={opened.retract}
          swapped={opened.swapped}
          count={books.length}
          handlers={handlers(openBook)}
          onShown={onShown}
          onClose={close}
          onStep={step}
        />
      )}
    </section>
  )

  function endDrag() {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    setDragging(false)
    // The click that ends a drag shouldn't open the book under the pointer.
    justDragged.current = true
    window.setTimeout(() => (justDragged.current = false), 0)
  }
}

function poseOf(slot: HTMLElement): SlotPose {
  const { left, top, width, height } = slot.getBoundingClientRect()
  return {
    rect: { left, top, width, height },
    turn: Number.parseFloat(slot.style.getPropertyValue('--turn')) || 0,
    eye: slot.style.getPropertyValue('--eye') || '50%',
  }
}

type SlotProps = {
  book: Book
  copy: number
  /** Only one copy of the row takes part in tabbing and the accessibility tree. */
  focusable: boolean
  /** Taken off the shelf: its place stays empty. */
  out: boolean
  arriving: boolean
  onOpen: (id: number, slot: HTMLElement) => void
  onHover: (book: Book | null, slot?: HTMLElement) => void
  onFocusSlot: (slot: HTMLElement) => void
}

/**
 * The button stays put as the hit target while the book inside it moves, so a book sliding
 * out never slips out from under the pointer.
 */
const ShelfSlot = memo(function ShelfSlot({ book, copy, focusable, out, arriving, onOpen, onHover, onFocusSlot }: SlotProps) {
  const look = useCoverLook(book.id)
  const width = spineWidth(book)
  const height = spineHeight(look)
  const state = book.status === 'ready' ? progressLabel(book) : STATUS[book.status].label
  const label = [book.title, book.author, state].filter(Boolean).join(', ')

  return (
    <button
      type="button"
      className={cx('shelf-slot', out && 'is-out', arriving && 'is-arriving')}
      style={{ '--w': `${width}px`, '--h': `${height}px` } as CSSProperties}
      data-book={book.id}
      data-copy={copy}
      tabIndex={focusable ? 0 : -1}
      aria-hidden={focusable ? undefined : true}
      aria-label={label}
      onClick={(e) => onOpen(book.id, e.currentTarget)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(book, e.currentTarget)}
      onPointerLeave={() => onHover(null)}
      onFocus={(e) => onFocusSlot(e.currentTarget)}
    >
      <span className="shelf-turn">
        <Book3D book={book} look={look} width={width} height={height} className="shelf-lift" />
      </span>
    </button>
  )
})

/** Floats above the hovered book, outside the rail so nothing clips it. */
function HoverCard({ book, rect }: { book: Book; rect: DOMRect }) {
  const status = STATUS[book.status]
  const progress = progressLabel(book)
  const left = Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140)

  return createPortal(
    <div className="shelf-card" style={{ left, top: rect.top - 52 }} aria-hidden>
      <p className="shelf-card-title">{book.title}</p>
      {book.author && <p className="shelf-card-author">{book.author}</p>}
      <p className="shelf-card-meta">
        {book.status === 'ready' ? (
          progress && <span className="tabular">{progress}</span>
        ) : (
          <>
            <StatusIcon state={status.state} progress={status.progress} />
            {status.label}
          </>
        )}
      </p>
    </div>,
    document.body,
  )
}
