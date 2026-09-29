import { cx } from './cx'
import './StatusIcon.css'

export type StatusState = 'idle' | 'progress' | 'done' | 'error'

type Props = {
  state: StatusState
  /** Accessible name, e.g. "Extracting text". Omit only when a visible label sits next to it. */
  label?: string
  /** How full the progress pie is, 0 to 1. */
  progress?: number
  size?: number
}

/** Linear-style status glyph: dashed ring, filling pie, check, or cross. */
export function StatusIcon({ state, label, progress = 0.5, size = 14 }: Props) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg
      className={cx('status-icon', `status-icon-${state}`)}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      {...a11y}
    >
      {label && <title>{label}</title>}
      {state === 'idle' && <circle className="ring dashed" cx="7" cy="7" r="6" />}
      {state === 'progress' && (
        <>
          <circle className="ring" cx="7" cy="7" r="6" />
          <path className="pie" d={pie(progress)} />
        </>
      )}
      {state === 'done' && (
        <>
          <circle className="disc" cx="7" cy="7" r="7" />
          <path className="mark" d="M4.1 7.2 6.1 9.1 9.9 5.2" />
        </>
      )}
      {state === 'error' && (
        <>
          <circle className="disc" cx="7" cy="7" r="7" />
          <path className="mark" d="M5 5 9 9M9 5 5 9" />
        </>
      )}
    </svg>
  )
}

/** A wedge from 12 o'clock, clockwise, covering `fraction` of a 3.5-radius disc. */
function pie(fraction: number) {
  const f = Math.min(Math.max(fraction, 0.02), 0.999)
  const angle = f * 2 * Math.PI
  const x = 7 + 3.5 * Math.sin(angle)
  const y = 7 - 3.5 * Math.cos(angle)
  return `M7 7V3.5A3.5 3.5 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`
}
