import { type FormEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import './Dialog.css'

type Props = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Right-aligned actions: Cancel first, the committing action last. */
  footer?: ReactNode
  /** Makes the panel a form, so a type="submit" button in the footer submits it. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void
}

/**
 * A modal on the native <dialog>, so focus trapping, Escape, and the top layer come free.
 * Content mounts only while open, so forms inside start fresh each time.
 */
export function Dialog({ open, onClose, title, description, children, footer, onSubmit }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      // The dialog element is only the target on its backdrop. Require press and release there,
      // so a text selection dragged out of an input doesn't close it.
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => pressedBackdrop.current && e.target === e.currentTarget && onClose()}
    >
      {open && (
        <Panel onSubmit={onSubmit}>
          <div className="dialog-head">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="dialog-description">
                {description}
              </p>
            )}
          </div>
          {children && <div className="dialog-body">{children}</div>}
          {footer && <div className="dialog-footer">{footer}</div>}
        </Panel>
      )}
    </dialog>
  )
}

function Panel({ onSubmit, children }: { onSubmit?: Props['onSubmit']; children: ReactNode }) {
  return onSubmit ? (
    <form className="dialog-panel" onSubmit={onSubmit}>
      {children}
    </form>
  ) : (
    <div className="dialog-panel">{children}</div>
  )
}
