import { type ComponentProps, type InputHTMLAttributes, type ReactNode, useCallback, useLayoutEffect, useRef } from 'react'
import { cx } from './cx'
import './Field.css'

type InputProps = {
  /** 26px tall instead of 32, for toolbars. */
  compact?: boolean
  mono?: boolean
} & ComponentProps<'input'>

export function Input({ compact, mono, className, ...rest }: InputProps) {
  return (
    <input className={cx('input', compact && 'input-compact', mono && 'text-mono', className)} {...rest} />
  )
}

type TextareaProps = {
  /** Grow with the text, from `rows` up to the CSS max-height (then scroll), instead of resizing by hand. */
  autoGrow?: boolean
} & ComponentProps<'textarea'>

/** Multi-line text, styled like Input. */
export function Textarea({ autoGrow, className, ref, value, ...rest }: TextareaProps) {
  const own = useRef<HTMLTextAreaElement | null>(null)
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )

  useLayoutEffect(() => {
    const el = own.current
    if (!autoGrow || !el) return
    el.style.height = 'auto'
    // scrollHeight leaves out the border, which border-box sizing counts.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [autoGrow, value])

  return (
    <textarea
      ref={setRef}
      value={value}
      className={cx('input', 'textarea', autoGrow && 'textarea-grow', className)}
      {...rest}
    />
  )
}

/** A label stacked over its control, with an optional hint underneath. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/** An on/off setting that applies immediately. Use a checkbox inside forms that submit. */
export function Switch({
  label,
  className,
  ...rest
}: { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>) {
  return (
    <label className={cx('switch', className)}>
      <input type="checkbox" role="switch" className="switch-input" {...rest} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-label">{label}</span>
    </label>
  )
}
