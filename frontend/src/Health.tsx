import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, formatDate, type Appetite, type Energy, type HealthLog, type Pet, type Potty, type Role, type Water } from './api'
import { HealthChart } from './HealthChart'
import { stampFor, todayIn } from './time'
import { Field, Group, Segmented, When } from './ui'

const APPETITE: { value: Appetite; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'some', label: 'Some' },
  { value: 'normal', label: 'Normal' },
]
const WATER: { value: Water; label: string }[] = [
  { value: 'less', label: 'Less' },
  { value: 'normal', label: 'Normal' },
  { value: 'more', label: 'More' },
]
const ENERGY: { value: Energy; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]
const POTTY: { value: Potty; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'off', label: 'Off' },
]

export function Health({ pet, role }: { pet: Pet; role: Role }) {
  const [logs, setLogs] = useState<HealthLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [today] = useState(() => todayIn(pet.home_timezone))

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
      {role === 'caretaker' &&
        (adding ? (
          <HealthForm
            pet={pet}
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
        {logs && <HealthChart logs={logs} today={today} />}
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
                <HealthRow key={l.id} log={l} pet={pet} role={role} />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function HealthRow({ log, pet, role }: { log: HealthLog; pet: Pet; role: Role }) {
  const chips: { label: string; value: string; flag?: boolean }[] = []
  if (log.weight != null) chips.push({ label: 'Weight', value: `${log.weight} ${log.weight_unit}` })
  if (log.appetite) chips.push({ label: 'Appetite', value: cap(log.appetite), flag: log.appetite !== 'normal' })
  if (log.water) chips.push({ label: 'Water', value: cap(log.water), flag: log.water !== 'normal' })
  if (log.energy) chips.push({ label: 'Energy', value: cap(log.energy), flag: log.energy === 'low' })
  if (log.potty) chips.push({ label: 'Potty', value: cap(log.potty), flag: log.potty === 'off' })
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

function HealthForm({ pet, onCancel, onSaved }: { pet: Pet; onCancel: () => void; onSaved: () => void }) {
  const [weight, setWeight] = useState('')
  const [appetite, setAppetite] = useState<Appetite | null>(null)
  const [water, setWater] = useState<Water | null>(null)
  const [energy, setEnergy] = useState<Energy | null>(null)
  const [potty, setPotty] = useState<Potty | null>(null)
  const [symptoms, setSymptoms] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.logHealth(pet.id, {
        weight: weight.trim() ? Number(weight) : null,
        appetite,
        water,
        energy,
        potty,
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
      <p className="muted small">Fill in whatever you noticed. Tap a choice again to clear it.</p>
      <div className="health-form-grid">
        <Group label="Appetite">
          <Segmented value={appetite} options={APPETITE} onChange={setAppetite} onClear={() => setAppetite(null)} label="Appetite" />
        </Group>
        <Group label="Energy">
          <Segmented value={energy} options={ENERGY} onChange={setEnergy} onClear={() => setEnergy(null)} label="Energy" />
        </Group>
        <Group label="Water">
          <Segmented value={water} options={WATER} onChange={setWater} onClear={() => setWater(null)} label="Water" />
        </Group>
        <Group label="Potty">
          <Segmented value={potty} options={POTTY} onChange={setPotty} onClear={() => setPotty(null)} label="Potty" />
        </Group>
        <Field label={`Weight (${pet.weight_unit}, optional)`}>
          <input type="number" min={0} step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      </div>
      <Field label="Symptoms or anything unusual">
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
