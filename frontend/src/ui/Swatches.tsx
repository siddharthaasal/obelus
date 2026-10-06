import { useId } from 'react'
import { cx } from './cx'
import './Swatches.css'

export type Swatch<T extends string> = { value: T; label: string; color: string }

type Props<T extends string> = {
  /** Accessible name for the group, e.g. "Highlight colour". */
  label: string
  options: Swatch<T>[]
  value: T
  onChange: (value: T) => void
}

/** A choice of colour, applied immediately. Native radios underneath, like SegmentedControl. */
export function Swatches<T extends string>({ label, options, value, onChange }: Props<T>) {
  const name = useId()
  return (
    <div className="color-picker" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={cx('color-option', o.value === value && 'is-checked')} title={o.label}>
          <input
            type="radio"
            className="color-option-input"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          <span className="color-option-dot" style={{ background: o.color }} aria-hidden />
          <span className="visually-hidden">{o.label}</span>
        </label>
      ))}
    </div>
  )
}
