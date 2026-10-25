import type { ReactNode } from 'react'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** A row of pill buttons for picking one value. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  onClear,
}: {
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label?: string
  /** If set, tapping the selected option clears it. */
  onClear?: () => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => (onClear && value === o.value ? onClear() : onChange(o.value))}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Like Field, but a plain group (for button rows, which a <label> would hijack). */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span>{label}</span>
      {children}
    </div>
  )
}
