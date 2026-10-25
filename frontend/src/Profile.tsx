import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, type EmergencyFields, type Pet, type PetInput, type Role } from './api'
import { PetAvatar } from './PetAvatar'
import { timeIn } from './time'
import { Field } from './ui'

export function Profile({
  pet,
  role,
  onPetChanged,
  onPetDeleted,
  onResetSamples,
}: {
  pet: Pet
  role: Role
  onPetChanged: (p: Pet) => void
  onPetDeleted: () => void
  onResetSamples: () => void
}) {
  if (role === 'caretaker') return <ProfileReadOnly pet={pet} />
  return (
    <div className="stack">
      <ProfileForm key={`p${pet.id}`} pet={pet} onSaved={onPetChanged} onDeleted={onPetDeleted} />
      <EmergencyForm key={`e${pet.id}`} pet={pet} />
      {pet.is_sample && (
        <section className="card sample-box">
          <h2>Sample data</h2>
          <p className="muted small">
            Re-create both sample pets with a fresh sample week ending yesterday. Your own pets aren't touched.
          </p>
          <button className="btn ghost" onClick={onResetSamples}>
            Reset sample data
          </button>
        </section>
      )}
    </div>
  )
}

function ProfileReadOnly({ pet }: { pet: Pet }) {
  const [now] = useState(() => new Date())
  const facts = [
    ['Species', pet.species],
    ['Breed', pet.breed],
    ['Age', pet.age_years != null ? `${pet.age_years} years` : ''],
    ['Weight', pet.weight != null ? `${pet.weight} ${pet.weight_unit}` : ''],
    ['Owner’s time', `${timeIn(now, pet.owner_timezone)} (${pet.owner_timezone.replace(/_/g, ' ')})`],
  ].filter(([, v]) => v)
  return (
    <section className="card profile-ro">
      <div className="hero-pet">
        <PetAvatar pet={pet} size={96} />
        <div>
          <h1>{pet.name}</h1>
          {pet.is_sample && <span className="badge sample">Sample data</span>}
        </div>
      </div>
      <dl className="snapshot">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {pet.quirks && (
        <>
          <h2>Quirks</h2>
          <p className="quirks">{pet.quirks}</p>
        </>
      )}
      <p className="muted small">Medical details, vet and contacts are on the red emergency card.</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Owner: edit the profile (also used to add a new pet)
// ---------------------------------------------------------------------------

const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'UTC']
  }
})()

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'

const emptyPet = (): PetInput => ({
  name: '',
  species: '',
  breed: '',
  age_years: null,
  weight: null,
  weight_unit: 'lb',
  quirks: '',
  owner_timezone: browserTz(),
  home_timezone: browserTz(),
  caretaker_name: '',
})

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

function ZoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const zones = useMemo(() => (TIMEZONES.includes(value) ? TIMEZONES : [value, ...TIMEZONES]), [value])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  )
}

export function ProfileForm({
  pet,
  onSaved,
  onDeleted,
  onCancel,
}: {
  pet: Pet | null
  onSaved: (p: Pet) => void
  onDeleted?: () => void
  onCancel?: () => void
}) {
  const [form, setForm] = useState<PetInput>(() => (pet ? { ...pet } : emptyPet()))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = <K extends keyof PetInput>(k: K, v: PetInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    const body: PetInput = {
      name: form.name,
      species: form.species,
      breed: form.breed,
      age_years: form.age_years,
      weight: form.weight,
      weight_unit: form.weight_unit,
      quirks: form.quirks,
      owner_timezone: form.owner_timezone,
      home_timezone: form.home_timezone,
      caretaker_name: form.caretaker_name,
    }
    try {
      const saved = pet ? await api.updatePet(pet.id, body) : await api.createPet(body)
      onSaved(saved)
      setMsg({ ok: true, text: 'Saved.' })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const uploadPhoto = async (file: File | undefined) => {
    if (!pet || !file) return
    try {
      onSaved(await api.uploadPetPhoto(pet.id, file))
      setMsg({ ok: true, text: 'Photo updated.' })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
  }

  const remove = async () => {
    if (!pet || !confirm(`Delete ${pet.name} and everything logged for them? This can't be undone.`)) return
    await api.deletePet(pet.id)
    onDeleted?.()
  }

  return (
    <form className="card form" onSubmit={submit}>
      {!pet && <img className="form-hero" src="/pets/happy-dog.jpg" alt="" />}
      <h2>{pet ? 'Pet profile' : 'Add a pet'}</h2>
      {pet && (
        <div className="inline photo-row">
          <PetAvatar pet={pet} size={72} />
          <Field label="Photo">
            <input type="file" accept="image/*" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
          </Field>
        </div>
      )}
      <div className="grid-2">
        <Field label="Name *">
          <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Species *">
          <input required value={form.species} onChange={(e) => set('species', e.target.value)} placeholder="Cat, dog, rabbit…" />
        </Field>
        <Field label="Breed">
          <input value={form.breed} onChange={(e) => set('breed', e.target.value)} />
        </Field>
        <Field label="Age (years)">
          <input type="number" min={0} step="0.5" value={form.age_years ?? ''} onChange={(e) => set('age_years', numOrNull(e.target.value))} />
        </Field>
        <Field label="Weight">
          <div className="inline">
            <input type="number" min={0} step="0.1" value={form.weight ?? ''} onChange={(e) => set('weight', numOrNull(e.target.value))} />
            <select value={form.weight_unit} onChange={(e) => set('weight_unit', e.target.value as 'lb' | 'kg')}>
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </Field>
        <Field label="Caretaker's name">
          <input value={form.caretaker_name} onChange={(e) => set('caretaker_name', e.target.value)} placeholder="Who's looking after them?" />
        </Field>
        <Field label="Owner's time zone (where you are)">
          <ZoneSelect value={form.owner_timezone} onChange={(v) => set('owner_timezone', v)} />
        </Field>
        <Field label="Pet's home time zone (where the caretaker is)">
          <ZoneSelect value={form.home_timezone} onChange={(v) => set('home_timezone', v)} />
        </Field>
      </div>
      <Field label="Quirks">
        <textarea
          rows={3}
          value={form.quirks}
          onChange={(e) => set('quirks', e.target.value)}
          placeholder="Habits, fears, favourite spots, things the caretaker should know"
        />
      </Field>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <div className="form-actions">
        <button className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : pet ? 'Save profile' : 'Add pet'}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        {pet && (
          <button type="button" className="btn danger-link" onClick={remove}>
            Delete pet
          </button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Owner: edit the emergency card
// ---------------------------------------------------------------------------

const EMERGENCY_FIELDS: { key: keyof EmergencyFields; label: string; long?: boolean }[] = [
  { key: 'owner_name', label: 'Owner name' },
  { key: 'owner_phone', label: 'Owner phone' },
  { key: 'backup_name', label: 'Backup contact name' },
  { key: 'backup_phone', label: 'Backup contact phone' },
  { key: 'vet_name', label: 'Vet name / clinic' },
  { key: 'vet_phone', label: 'Vet phone' },
  { key: 'vet_address', label: 'Vet address', long: true },
  { key: 'allergies', label: 'Allergies', long: true },
  { key: 'conditions', label: 'Conditions', long: true },
  { key: 'medications', label: 'Medications', long: true },
  { key: 'diet', label: 'Diet', long: true },
  { key: 'vaccines', label: 'Vaccines (one line)' },
  { key: 'microchip_number', label: 'Microchip number' },
]

function EmergencyForm({ pet }: { pet: Pet }) {
  const [form, setForm] = useState<EmergencyFields | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.emergency(pet.id).then(
      ({ pet_id: _id, pet: _pet, scheduled_meds: _meds, ...fields }) => setForm(fields),
      (e) => setMsg({ ok: false, text: e.message }),
    )
  }, [pet.id])

  if (!form) return <div className="card">{msg ? <p className="error">{msg.text}</p> : 'Loading…'}</div>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.updateEmergency(pet.id, form)
      setMsg({ ok: true, text: 'Emergency card saved.' })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Emergency card</h2>
      <p className="muted small">The caretaker can open this card from the red button on any screen.</p>
      <div className="grid-2">
        {EMERGENCY_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.long ? (
              <textarea rows={2} value={(form[f.key] as string) ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input value={(form[f.key] as string) ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
        <Field label="Emergency spending limit ($)">
          <input
            type="number"
            min={0}
            step={50}
            value={form.emergency_spending_limit ?? ''}
            onChange={(e) => setForm({ ...form, emergency_spending_limit: numOrNull(e.target.value) })}
          />
        </Field>
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <div className="form-actions">
        <button className="btn primary">Save emergency card</button>
      </div>
    </form>
  )
}
