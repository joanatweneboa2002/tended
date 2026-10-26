import type { CSSProperties, ReactNode } from 'react'

/** A pet's name never breaks mid-word: the longest word sets a smaller size instead. */
export function nameFit(name: string): CSSProperties {
  const longest = Math.max(...name.split(/[\s-]+/).map((w) => w.length)) // may break at spaces and hyphens
  const scale = longest <= 7 ? 1 : longest <= 9 ? 0.86 : longest <= 12 ? 0.72 : longest <= 16 ? 0.58 : 0.48
  return { fontSize: `${scale}em` }
}

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

/** A time for the viewer: home time, then (owner only) their own time, small and gray. */
export function When({ t }: { t: { main: string; yours: string | null } }) {
  return (
    <span className="when">
      {t.main}
      {t.yours && <small className="your-time"> · {t.yours} for you</small>}
    </span>
  )
}
