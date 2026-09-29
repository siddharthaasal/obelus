import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cx } from './cx'
import './Button.css'

/**
 * primary: the single acid-lime action in a view. secondary: outlined, for everything else
 * that matters. ghost: quiet, for toolbars and row actions. danger: confirming destruction.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

type Common = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon. With no children the button is square: give it an aria-label and a title. */
  icon?: LucideIcon
  children?: ReactNode
}

function classes(
  { variant = 'secondary', size = 'md', icon, children }: Common,
  className?: string,
) {
  return cx('btn', `btn-${variant}`, `btn-${size}`, icon && !children && 'btn-icon', className)
}

function Content({ icon: Icon, size, children }: Common) {
  return (
    <>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden />}
      {children}
    </>
  )
}

export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ variant, size, icon, children, className, type, ...rest }: ButtonProps) {
  const common = { variant, size, icon, children }
  return (
    <button type={type ?? 'button'} className={classes(common, className)} {...rest}>
      <Content {...common} />
    </button>
  )
}

/** A router link that looks like a button, for actions that navigate. */
export function ButtonLink({ variant, size, icon, children, className, ...rest }: Common & LinkProps) {
  const common = { variant, size, icon, children }
  return (
    <Link className={classes(common, className)} {...rest}>
      <Content {...common} />
    </Link>
  )
}
