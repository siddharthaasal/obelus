import type { ComponentProps, InputHTMLAttributes, ReactNode } from 'react'
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
