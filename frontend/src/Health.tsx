import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, formatDate, type HealthInput, type HealthLog, type Pet, type Role } from './api'
import { HealthChart } from './HealthChart'
import { chipsFor, FIELDS, speciesGroup, type ChoiceKey, type SpeciesGroup } from './healthFields'
import { stampFor, todayIn } from './time'
import { Field, Group, Segmented, When } from './ui'

export function Health({ pet, role }: { pet: Pet; role: Role }) {
  const [logs, setLogs] = useState<HealthLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [today] = useState(() => todayIn(pet.home_timezone))
  const group = speciesGroup(pet.species)
  const choices = FIELDS[group].choices
  const titles = {
    appetite: choices.find((c) => c.key === 'appetite')!.label,
    energy: choices.find((c) => c.key === 'energy')?.label,
  }

  const load = useCallback(() => {
    api.health(pet.id, 14).then(setLogs, (e) => setError(e.message))
  }, [pet.id])
  useEffect(load, [load])

  const byDay = useMemo(() => {
    const groups = new Map<string, HealthLog[]>()
    for (const l of logs ?? []) groups.set(l.log_date, [...(groups.get(l.log_date) ?? []), l])
    return [...groups.entries()]
  }, [logs])

  return (
    <div className="stack">
      {role === 'caretaker' && (
        <p className="health-hint">
          Log how {pet.name} is doing today. Fill in what you noticed, skip the rest.
        </p>
      )}
      {role === 'caretaker' &&
        (adding ? (
          <HealthForm
            pet={pet}
            group={group}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false)
              load()
            }}
          />
        ) : (
          <button className="btn primary block" onClick={() => setAdding(true)}>
            + Log health for {pet.name}
          </button>
        ))}

      <section className="card">
        <h2>Last 7 days</h2>
        {logs && <HealthChart logs={logs} today={today} titles={titles} />}
      </section>

      <section className="card">
        <h2>Health log</h2>
        {error && <p className="error">{error}</p>}
        {logs && logs.length === 0 && <p className="empty">Nothing logged yet.</p>}
        {byDay.map(([day, list]) => (
          <div key={day} className="history-day">
            <h3>{day === today ? 'Today' : formatDate(day, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
            <ul className="health-list">
              {list.map((l) => (
                <HealthRow key={l.id} log={l} pet={pet} role={role} group={group} />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}

function HealthRow({ log, pet, role, group }: { log: HealthLog; pet: Pet; role: Role; group: SpeciesGroup }) {
  const chips = chipsFor(log, group)
  return (
    <li className="health-row">
      <div className="health-chips">
        {chips.map((c) => (
          <span key={c.label} className={`chip ${c.flag ? 'flag' : ''}`}>
            <b>{c.label}</b> {c.value}
          </span>
        ))}
      </div>
      {log.symptoms && <p className="symptoms">“{log.symptoms}”</p>}
      <p className="muted small">
        <When t={stampFor(log.logged_at, pet, role)} />
        {log.logged_by && ` · ${log.logged_by}`}
      </p>
    </li>
  )
}

function HealthForm({ pet, group, onCancel, onSaved }: { pet: Pet; group: SpeciesGroup; onCancel: () => void; onSaved: () => void }) {
  const { weight: hasWeight, choices } = FIELDS[group]
  const [values, setValues] = useState<Partial<Record<ChoiceKey, string>>>({})
  const [weight, setWeight] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: ChoiceKey, v: string | null) => setValues((x) => ({ ...x, [k]: v ?? undefined }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.logHealth(pet.id, {
        ...(values as HealthInput),
        weight: hasWeight && weight.trim() ? Number(weight) : null,
        symptoms,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>How is {pet.name} today?</h2>
      <p className="muted small">Everything is optional. Tap a choice again to clear it.</p>
      <div className="health-form-grid">
        {choices.map((c) => (
          <Group key={c.key} label={c.label}>
            <Segmented
              value={values[c.key] ?? null}
              options={c.options}
              onChange={(v) => set(c.key, v)}
              onClear={() => set(c.key, null)}
              label={c.label}
            />
          </Group>
        ))}
        {hasWeight && (
          <Field label={`Weight (${pet.weight_unit})`}>
            <input type="number" min={0} step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Notes (anything unusual)">
        <textarea rows={2} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. sneezing, hiding, threw up once" />
      </Field>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save health entry'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
