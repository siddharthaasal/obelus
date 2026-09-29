import { CircleAlert, Info, X } from 'lucide-react'
import { Button } from './Button'
import { cx } from './cx'
import type { ToastItem } from './useToasts'
import './Toasts.css'

/** Transient messages, stacked bottom right. Pair with useToasts(). */
export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <ol className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <li key={t.id} className={cx('toast', `toast-${t.tone}`)} role={t.tone === 'error' ? 'alert' : 'status'}>
          {t.tone === 'error' ? <CircleAlert className="toast-icon" /> : <Info className="toast-icon" />}
          <span className="toast-text">{t.text}</span>
          <Button variant="ghost" size="sm" icon={X} aria-label="Dismiss" onClick={() => onDismiss(t.id)} />
        </li>
      ))}
    </ol>
  )
}
