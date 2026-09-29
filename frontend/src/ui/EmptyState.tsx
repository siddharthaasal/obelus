import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import './EmptyState.css'

type Props = {
  icon?: LucideIcon
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

/** What a list or panel shows when it has nothing in it yet. */
export function EmptyState({ icon: Icon, title, children, actions }: Props) {
  return (
    <div className="empty-state">
      {Icon && (
        <span className="empty-state-icon">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <p className="empty-state-title">{title}</p>
      {children && <div className="empty-state-body">{children}</div>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  )
}
