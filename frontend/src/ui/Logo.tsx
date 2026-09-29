import './Logo.css'

/** The obelus (÷) glyph and wordmark. */
export function Logo({ wordmark = true }: { wordmark?: boolean }) {
  return (
    <span className="logo">
      <svg className="logo-glyph" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="3.5" r="1.6" />
        <rect x="2" y="7.1" width="12" height="1.8" rx="0.9" />
        <circle cx="8" cy="12.5" r="1.6" />
      </svg>
      {wordmark && <span className="logo-wordmark">Obelus</span>}
    </span>
  )
}
