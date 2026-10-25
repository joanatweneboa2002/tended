import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Appointment, type AppointmentInput, type AppointmentKind, type Pet, type Role } from './api'
import { todayIn, wallForViewer } from './time'
import { Field, Group, Segmented } from './ui'

const KIND: Record<AppointmentKind, { label: string; icon: string }> = {
  vet: { label: 'Vet', icon: '🩺' },
  groomer: { label: 'Groomer', icon: '✂️' },
  other: { label: 'Other', icon: '📍' },
}

function whoLabel(a: Appointment, pet: Pet, role: Role): string {
  if (a.taken_by === role) return 'You’re taking ' + pet.name
  return a.taken_by === 'caretaker' ? `${pet.caretaker_name || 'Caretaker'} is taking ${pet.name}` : `Owner is taking ${pet.name}`
}

/** One appointment, compact. Used on the dashboard and in the list. */
export function AppointmentSummary({ a, pet, role }: { a: Appointment; pet: Pet; role: Role }) {
  const t = wallForViewer(a.date, a.time, pet, role)
  return (
    <div className="appt-summary">
      <div className="appt-date">
        <span className="appt-icon" aria-hidden>{KIND[a.kind].icon}</span>
        <div>
          <div className="task-head">
            <strong>{a.title}</strong>
            <span className={`type-tag kind-${a.kind}`}>{KIND[a.kind].label}</span>
          </div>
          <p>
            {t.day} · {t.main}
            {t.yours && <span className="your-time"> · {t.yours} for you</span>}
          </p>
        </div>
      </div>
      {(a.place_name || a.address) && (
        <p className="appt-place">
          {a.place_name}
          {a.address && (
            <>
              {a.place_name && <br />}
              <a href={`https://maps.google.com/?q=${encodeURIComponent(a.address)}`} target="_blank" rel="noreferrer">
                {a.address}
              </a>
            </>
          )}
        </p>
      )}
      <p className="muted small">{whoLabel(a, pet, role)}</p>
    </div>
  )
}

export function Appointments({ pet, role }: { pet: Pet; role: Role }) {
  const [list, setList] = useState<Appointment[] | null>(null)
  const [editing, setEditing] = useState<Appointment | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.appointments(pet.id).then(setList, (e) => setError(e.message))
  }, [pet.id])
  useEffect(load, [load])

  const done = () => {
    setEditing(null)
    load()
  }
  const upcoming = list?.filter((a) => !a.is_past) ?? []
  const past = (list?.filter((a) => a.is_past) ?? []).reverse()

  const card = (a: Appointment) =>
    editing !== null && editing !== 'new' && editing.id === a.id ? (
      <li key={a.id}>
        <AppointmentForm pet={pet} appt={a} onDone={done} />
      </li>
    ) : (
      <li key={a.id} className={`appt card ${a.is_past ? 'is-past' : ''}`}>
        <AppointmentSummary a={a} pet={pet} role={role} />
        {a.bring && (
          <p className="appt-bring">
            <b>Bring:</b> {a.bring}
          </p>
        )}
        {a.visit_notes ? (
          <p className="appt-notes">
            <b>After the visit:</b> {a.visit_notes}
          </p>
        ) : (
          a.is_past && <p className="muted small">No visit notes yet.</p>
        )}
        <div className="row-actions">
          <button className="btn ghost small" onClick={() => setEditing(a)}>
            {a.is_past && !a.visit_notes ? 'Add visit notes' : 'Edit'}
          </button>
          <button
            className="btn ghost small"
            onClick={async () => {
              if (!confirm(`Delete "${a.title}"?`)) return
              await api.deleteAppointment(a.id)
              load()
            }}
          >
            Delete
          </button>
        </div>
      </li>
    )

  return (
    <div className="stack">
      {editing === 'new' ? (
        <AppointmentForm pet={pet} appt={null} onDone={done} />
      ) : (
        <button className="btn primary block" onClick={() => setEditing('new')}>
          + Add appointment
        </button>
      )}
      {error && <p className="error">{error}</p>}

      <h2 className="section-title">Upcoming</h2>
      {list && upcoming.length === 0 && <p className="empty card">No upcoming appointments.</p>}
      <ul className="appt-list">{upcoming.map(card)}</ul>

      {past.length > 0 && (
        <>
          <h2 className="section-title">Past</h2>
          <ul className="appt-list">{past.map(card)}</ul>
        </>
      )}
    </div>
  )
}

function AppointmentForm({ pet, appt, onDone }: { pet: Pet; appt: Appointment | null; onDone: () => void }) {
  const [form, setForm] = useState<AppointmentInput>(() =>
    appt
      ? { ...appt }
      : {
          kind: 'vet',
          title: '',
          date: todayIn(pet.home_timezone),
          time: '10:00',
          place_name: '',
          address: '',
          taken_by: 'caretaker',
          bring: '',
          visit_notes: '',
        },
  )
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof AppointmentInput>(k: K, v: AppointmentInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body: AppointmentInput = {
      kind: form.kind,
      title: form.title,
      date: form.date,
      time: form.time,
      place_name: form.place_name,
      address: form.address,
      taken_by: form.taken_by,
      bring: form.bring,
      visit_notes: form.visit_notes,
    }
    try {
      if (appt) await api.updateAppointment(appt.id, body)
      else await api.createAppointment(pet.id, body)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{appt ? 'Edit appointment' : 'New appointment'}</h2>
      <div className="grid-2">
        <Group label="Type">
          <Segmented
            value={form.kind}
            onChange={(v) => set('kind', v)}
            options={(['vet', 'groomer', 'other'] as const).map((k) => ({ value: k, label: `${KIND[k].icon} ${KIND[k].label}` }))}
            label="Type"
          />
        </Group>
        <Field label="What is it? *">
          <input required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Annual checkup" />
        </Field>
        <Field label={`Date * (${pet.name}'s home time)`}>
          <input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Time *">
          <input type="time" required value={form.time} onChange={(e) => set('time', e.target.value)} />
        </Field>
        <Field label="Place">
          <input value={form.place_name} onChange={(e) => set('place_name', e.target.value)} placeholder="Clinic or groomer name" />
        </Field>
        <Field label="Address">
          <input value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Group label="Who's taking them?">
          <Segmented
            value={form.taken_by}
            onChange={(v) => set('taken_by', v)}
            options={[
              { value: 'caretaker', label: pet.caretaker_name || 'Caretaker' },
              { value: 'owner', label: 'Owner' },
            ]}
            label="Who's taking them?"
          />
        </Group>
        <Field label="What to bring">
          <input value={form.bring} onChange={(e) => set('bring', e.target.value)} placeholder="Carrier, records, stool sample…" />
        </Field>
      </div>
      <Field label="Notes after the visit">
        <textarea rows={3} value={form.visit_notes} onChange={(e) => set('visit_notes', e.target.value)} placeholder="What the vet or groomer said" />
      </Field>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="btn primary">{appt ? 'Save' : 'Add appointment'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
