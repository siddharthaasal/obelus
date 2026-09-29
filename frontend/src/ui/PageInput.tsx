import { type Ref, useRef, useState } from 'react'
import { Input } from './Field'
import './PageInput.css'

type Props = {
  value: number
  max: number
  onGo: (page: number) => void
  ref?: Ref<HTMLInputElement>
}

/**
 * A page number field. Shows the current page; type a number and press Enter (or leave the
 * field) to go there, Escape to cancel.
 */
export function PageInput({ value, max, onGo, ref }: Props) {
  // null while not editing, so the field follows `value` as the reader scrolls.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  function finish() {
    const n = Math.round(Number(draft))
    if (!cancelled.current && draft !== null && Number.isFinite(n) && n >= 1) onGo(Math.min(n, max))
    cancelled.current = false
    setDraft(null)
  }

  return (
    <Input
      ref={ref}
      compact
      mono
      className="page-input"
      inputMode="numeric"
      aria-label="Page number"
      value={draft ?? String(value)}
      size={String(max).length + 1}
      onFocus={(e) => {
        setDraft(String(value))
        e.currentTarget.select()
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          cancelled.current = e.key === 'Escape'
          e.currentTarget.blur()
        }
      }}
    />
  )
}
