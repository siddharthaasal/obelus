import { Highlighter, NotebookPen } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { LookupKind } from '../api'
import { KINDS } from '../panels/kinds'
import { Button, Kbd } from '../ui'
import { actionsFor, type ReaderSelection } from './selection'

type Props = {
  selection: ReaderSelection
  onAction: (kind: LookupKind) => void
  /** Highlight the selection, and with a note, open it to type in. */
  onHighlight: (withNote: boolean) => void
}

const GAP = 8
const MARGIN = 8

/** The actions for a selection, floating above it (below, near the top edge). */
export default function SelectionPopover({ selection, onAction, onHighlight }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const stage = el?.offsetParent
    if (!el || !stage) return
    let frame = 0
    const place = () => {
      const s = stage.getBoundingClientRect()
      const r = selection.range.getBoundingClientRect()
      const onScreen = r.bottom > s.top && r.top < s.bottom && r.width + r.height > 0
      el.style.visibility = onScreen ? '' : 'hidden'
      const above = r.top - s.top - GAP - el.offsetHeight
      const top = above >= MARGIN ? above : r.bottom - s.top + GAP
      const center = r.left + r.width / 2 - s.left
      const left = Math.min(Math.max(center - el.offsetWidth / 2, MARGIN), s.width - el.offsetWidth - MARGIN)
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    // Follow the selection as the viewer scrolls.
    const scroller = selection.viewer
    place()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [selection])

  return (
    <div
      ref={ref}
      className="selection-popover"
      role="toolbar"
      aria-label="Actions for the selection"
      // A mousedown here would clear the selection before the click lands.
      onMouseDown={(e) => e.preventDefault()}
    >
      {actionsFor(selection).map((kind) => {
        const { label, key, icon } = KINDS[kind]
        return (
          <Button key={kind} variant="ghost" size="sm" icon={icon} title={`${label} (${key})`} onClick={() => onAction(kind)}>
            {label}
            <Kbd>{key}</Kbd>
          </Button>
        )
      })}
      <span className="selection-popover-divider" aria-hidden />
      <Button variant="ghost" size="sm" icon={Highlighter} title="Highlight (H)" onClick={() => onHighlight(false)}>
        Highlight
        <Kbd>H</Kbd>
      </Button>
      <Button variant="ghost" size="sm" icon={NotebookPen} title="Highlight with a note (N)" onClick={() => onHighlight(true)}>
        Note
        <Kbd>N</Kbd>
      </Button>
    </div>
  )
}
