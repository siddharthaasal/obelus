import type { ReactNode } from 'react'
import './PageHeader.css'

type Props = {
  /** A breadcrumb or context line above the title. */
  eyebrow?: ReactNode
  title: ReactNode
  /** Sits on the title's baseline: a count badge, a status. */
  accessory?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

/** Title block at the top of a page, with its actions on the right. */
export function PageHeader({ eyebrow, title, accessory, description, actions }: Props) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {eyebrow && <div className="page-header-eyebrow">{eyebrow}</div>}
        <div className="page-header-title-row">
          <h1 className="page-header-title">{title}</h1>
          {accessory}
        </div>
        {description && <div className="page-header-description">{description}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}
