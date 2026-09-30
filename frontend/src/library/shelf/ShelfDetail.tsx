import { BookOpen } from 'lucide-react'
import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import type { Book } from '../../api'
import { Button, ButtonLink, cx, Kbd, StatusIcon } from '../../ui'
import BookActions, { type BookHandlers } from '../BookActions'
import BookNotes from '../BookNotes'
import { useCoverLook } from '../cover'
import { isReadable, progressLabel, readerUrl, STATUS } from '../status'
import Book3D from './Book3D'
import { DEPTH, LIFT, PERSPECTIVE, PULL, spineWidth } from './geometry'

/** opening: still on the shelf, about to come out. open: cover facing you. closing: going back. */
export type Phase = 'opening' | 'open' | 'closing'

/** Where a book stands on the shelf, captured from its slot. */
export type SlotPose = {
  rect: { left: number; top: number; width: number; height: number }
  /** Its turn on the curved shelf, in degrees. */
  turn: number
  /** The slot's perspective origin, so the book leaves seen from the same place. */
  eye: string
}

type Props = {
  book: Book
  pose: SlotPose
  phase: Phase
  /** Closing slides the book back into its place; otherwise it just fades (it was removed). */
  retract: boolean
  /** Arrived by Previous or Next, so it appears in place instead of coming off the shelf. */
  swapped: boolean
  count: number
  handlers: BookHandlers
  onShown: () => void
  onClose: (options?: { retract?: boolean }) => void
  onStep: (delta: number) => void
}

const PANEL_GAP = 56
const NARROW = 720

/**
 * A book taken off the shelf. It leaves its slot, turns to show its front cover, and grows to
 * fill the middle of the window, with its details beside it. Everything behind blurs.
 */
export default function ShelfDetail({ book, pose, phase, retract, swapped, count, handlers, onShown, onClose, onStep }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const navigate = useNavigate()
  const look = useCoverLook(book.id)
  const viewport = useViewport()
  const status = STATUS[book.status]
  const readable = isReadable(book)

  useLayoutEffect(() => {
    const el = dialog.current
    if (el && !el.open) el.showModal()
  }, [])

  // Arrows browse the shelf. Listen on the window: clicking the backdrop or the text leaves
  // focus on the body, outside the dialog.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      // Keys in a dialog opened from here (edit, remove) belong to it.
      const inside = (e.target as HTMLElement).closest('dialog')
      if (inside && inside !== dialog.current) return
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      e.preventDefault()
      onStep(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])

  // Paint the book in its shelf pose first, then let it go.
  useEffect(() => {
    if (phase !== 'opening') return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(onShown)
    })
    return () => cancelAnimationFrame(frame)
  }, [phase, onShown])

  const { rect } = pose
  const width = rect.width || spineWidth(book)
  const height = rect.height
  const narrow = viewport.w < NARROW
  const coverH = narrow ? viewport.h * 0.42 : Math.min(viewport.h * 0.6, 480)
  const scale = coverH / height
  const coverW = DEPTH * scale
  const panelW = narrow ? viewport.w - 32 : Math.min(360, viewport.w - coverW - PANEL_GAP - 64)
  const coverLeft = narrow ? (viewport.w - coverW) / 2 : (viewport.w - (coverW + PANEL_GAP + panelW)) / 2
  const coverTop = narrow ? Math.max(24, viewport.h * 0.06) : (viewport.h - coverH) / 2

  // The book turns about the middle of its spine; turned a quarter, the cover's middle sits half
  // a cover to the right of it and half a spine towards you.
  const dx = coverLeft + coverW / 2 - (rect.left + width / 2) - coverW / 2
  const dy = coverTop + coverH / 2 - (rect.top + height / 2)
  const dz = (-width * scale) / 2
  const onShelf = (pulled: boolean) =>
    `translate3d(0px, 0px, 0px) scale3d(1, 1, 1) rotateY(${pose.turn}deg) translate3d(0px, ${pulled ? LIFT : 0}px, ${pulled ? PULL : 0}px)`
  const outOfShelf = `translate3d(${dx}px, ${dy}px, ${dz}px) scale3d(${scale}, ${scale}, ${scale}) rotateY(-90deg) translate3d(0px, 0px, 0px)`
  const transform =
    phase === 'opening' ? onShelf(true) : phase === 'closing' && retract ? onShelf(false) : outOfShelf

  const panelStyle: CSSProperties = narrow
    ? { left: 16, right: 16, top: coverTop + coverH + 24 }
    : { left: coverLeft + coverW + PANEL_GAP, top: viewport.h / 2, width: panelW, transform: 'translateY(-50%)' }

  return createPortal(
    <dialog
      ref={dialog}
      className="shelf-detail"
      data-phase={phase}
      data-retract={retract}
      aria-labelledby={titleId}
      // React passes these up from the edit and remove dialogs inside; those close on their own.
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        onClose()
      }}
      onClose={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="shelf-detail-backdrop" onClick={() => onClose()} />

      <div
        key={book.id}
        className={cx('shelf-detail-stage', swapped && 'is-swapped')}
        style={{ ...rect, perspective: PERSPECTIVE, perspectiveOrigin: `${pose.eye} 65%` }}
      >
        <Book3D
          book={book}
          look={look}
          width={width}
          height={height}
          full
          className={cx('shelf-detail-book', readable && 'is-readable')}
          style={{ transform }}
          onClick={readable ? () => navigate(readerUrl(book)) : undefined}
        />
      </div>

      <section className="shelf-detail-panel" style={panelStyle}>
        <div key={book.id} className={cx('shelf-detail-content', swapped && 'is-swapped')}>
          <p className="shelf-detail-eyebrow">
            {book.status === 'ready' ? (
              <span className="tabular">{[added(book), progressLabel(book)].filter(Boolean).join(' · ')}</span>
            ) : (
              <>
                <StatusIcon state={status.state} progress={status.progress} />
                {status.label}
              </>
            )}
          </p>
          <h2 id={titleId} className="shelf-detail-title">
            {book.title}
          </h2>
          {book.author && <p className="shelf-detail-author">{book.author}</p>}
          <p className="shelf-detail-file text-mono" title={book.file_name}>
            {book.file_name}
          </p>
          <BookNotes book={book} />
          <div className="shelf-detail-actions">
            {readable && (
              <ButtonLink to={readerUrl(book)} variant="primary" icon={BookOpen}>
                {book.last_read_page ? 'Continue reading' : 'Read'}
              </ButtonLink>
            )}
            <BookActions
              book={book}
              {...handlers}
              onRemove={() => {
                onClose({ retract: false })
                handlers.onRemove()
              }}
            />
          </div>
        </div>

        <div className="shelf-detail-nav">
          {count > 1 && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onStep(-1)} title="Previous book (←)">
                Previous
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onStep(1)} title="Next book (→)">
                Next
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => onClose()} title="Put it back (Esc)">
            Put back
          </Button>
          <span className="shelf-detail-keys" aria-hidden>
            {count > 1 && (
              <>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
              </>
            )}
            <Kbd>Esc</Kbd>
          </span>
        </div>
      </section>
    </dialog>,
    document.body,
  )
}

function added(book: Book) {
  const date = new Date(book.created_at)
  return `Added ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}
