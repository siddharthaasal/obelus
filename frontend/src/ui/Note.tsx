import { CircleAlert, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import './Note.css'

/** A line of inline status. The icon carries the tone; the text stays grey. */
export function Note({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : Info
  return (
    <p className={cx('note', `note-${tone}`)} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={14} className="note-icon" aria-hidden />
      <span>{children}</span>
    </p>
  )
}
