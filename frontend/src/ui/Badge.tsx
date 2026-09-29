import type { HTMLAttributes } from 'react'
import { cx } from './cx'
import './Badge.css'

export type BadgeTone = 'neutral' | 'green' | 'red' | 'teal' | 'violet' | 'lavender'

/** Inline metadata: a status word, a category, a count. */
export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: { tone?: BadgeTone } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('badge', `badge-${tone}`, className)} {...rest} />
}
