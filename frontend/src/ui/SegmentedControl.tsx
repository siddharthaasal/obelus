import type { LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { cx } from './cx'
import './SegmentedControl.css'

export type SegmentOption<T extends string> = { value: T; label: string; icon?: LucideIcon }

type Props<T extends string> = {
  /** Accessible name for the group, e.g. "Theme". */
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Show only icons; labels become tooltips and screen reader text. */
  iconOnly?: boolean
}

/**
 * One of a few options, applied immediately: a theme, a panel tab, a search mode.
 * Native radios underneath, so arrow keys and screen readers work as expected.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, iconOnly }: Props<T>) {
  const name = useId()
  return (
    <div className={cx('segmented', iconOnly && 'segmented-icon-only')} role="radiogroup" aria-label={label}>
      {options.map(({ value: option, label: optionLabel, icon: Icon }) => (
        <label key={option} className="segmented-option" title={iconOnly ? optionLabel : undefined}>
          <input
            type="radio"
            className="segmented-input"
            name={name}
            value={option}
            checked={option === value}
            onChange={() => onChange(option)}
          />
          {Icon && <Icon size={14} aria-hidden />}
          <span className={iconOnly ? 'visually-hidden' : undefined}>{optionLabel}</span>
        </label>
      ))}
    </div>
  )
}
