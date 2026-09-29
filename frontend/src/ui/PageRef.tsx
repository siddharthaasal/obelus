import { cx } from './cx'
import './PageRef.css'

type Props = {
  /** The PDF page it points to (what the reader navigates by). */
  page: number
  /** Last page of a span ("pp. 12–14"). */
  end?: number
  /** Printed page labels by PDF page (labels[page - 1]), when the PDF has them. */
  labels?: string[] | null
  onGo?: (page: number) => void
  className?: string
}

/**
 * A page citation: "p. 37". Shows the printed page number when the PDF defines labels, and
 * jumps to the PDF page on click.
 */
export function PageRef({ page, end, labels, onGo, className }: Props) {
  const label = (n: number) => labels?.[n - 1] ?? String(n)
  const span = end !== undefined && end !== page
  const text = span ? `pp. ${label(page)}–${label(end)}` : `p. ${label(page)}`
  if (!onGo) return <span className={cx('page-ref', className)}>{text}</span>
  const printed = label(page) !== String(page)
  return (
    <button
      type="button"
      className={cx('page-ref', className)}
      title={printed ? `Go to page ${label(page)} (PDF page ${page})` : `Go to page ${page}`}
      onClick={() => onGo(page)}
    >
      {text}
    </button>
  )
}
