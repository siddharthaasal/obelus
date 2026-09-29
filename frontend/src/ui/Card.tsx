import { createElement, type HTMLAttributes } from 'react'
import { cx } from './cx'
import './Card.css'

type Props = {
  as?: 'div' | 'section' | 'article' | 'ul' | 'ol'
  /** 24px padding. Turn off for lists whose rows bring their own. */
  padded?: boolean
} & HTMLAttributes<HTMLElement>

/** A carbon surface one step above the canvas, edged by an inset hairline. */
export function Card({ as = 'div', padded = true, className, ...rest }: Props) {
  return createElement(as, { className: cx('card', padded && 'card-padded', className), ...rest })
}
