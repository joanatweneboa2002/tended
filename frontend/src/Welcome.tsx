import { useEffect, useState, type FormEvent } from 'react'
import { api, type ApiError, type PetBrief, type Role, type User } from './api'
import { PawDoodle } from './Doodles'
import { PersonAvatar, RealBadge, roleLabel } from './People'
import { browserTz, ZoneSelect } from './Profile'
import { Field, Group, Segmented } from './ui'

type Person = User & { pets: PetBrief[] }

const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0])

/** "Fynn in Accra 🇬🇭", or "Clover and Kiwi in Tokyo 🇯🇵" when they share a city. */
function petsAndPlaces(pets: PetBrief[]): string {
  const byCity = new Map<string, PetBrief[]>()
  for (const p of pets) {
    const where = `${p.home_city || 'their home'} ${p.home_flag}`.trim()
    byCity.set(where, [...(byCity.get(where) ?? []), p])
  }
  return [...byCity.entries()].map(([where, list]) => `${and(list.map((p) => p.name))} in ${where}`).join(' · ')
}

/** "Who's using Tended?": demo accounts, one tap to enter. */
export function Welcome({ onPick }: { onPick: (u: User) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    api.users().then(setPeople, (e) =>
      setError(
        (e as ApiError).status === 404
          ? 'The backend is running an older version of Tended. Restart it (./dev.sh) and refresh.'
          : `Can't reach the backend: ${(e as Error).message}. Is it running on port 8000?`,
      ),
    )
  }, [])

  const section = (title: string, list: Person[]) => (
    <section className="people-section">
      <h2>{title}</h2>
      <ul className="people">
        {list.map((u) => (
          <li key={u.id}>
            <PersonCard u={u} onPick={() => onPick(u)} />
          </li>
        ))}
      </ul>
    </section>
  )

  return (
    <div className="app welcome">
      <header className="welcome-head">
        <span className="brand-mark" aria-hidden>
          <PawDoodle size={20} />
        </span>
        <span className="brand-name">Tended</span>
      </header>
      <div className="welcome-hero">
        <h1>Who's using Tended?</h1>
        <p>Pet owners and their pets are in different places. Pick someone to see Tended through their eyes.</p>
        {!joining && (
          <button className="btn primary join-btn" onClick={() => setJoining(true)}>
            New here? Create your profile
          </button>
        )}
      </div>
      {joining && <JoinForm onJoined={onPick} onCancel={() => setJoining(false)} />}
      {error && <p className="error">{error}</p>}
      <div className="people-columns">
        {people && section('Pet owners', people.filter((u) => u.role === 'owner'))}
        {people && section('Caretakers', people.filter((u) => u.role === 'caretaker'))}
      </div>
      <p className="demo-note">Demo accounts for testing, no password needed.</p>
    </div>
  )
}

function PersonCard({ u, onPick }: { u: Person; onPick: () => void }) {
  const route =
    u.role === 'owner'
      ? petsAndPlaces(u.pets)
      : u.pets.length
        ? `looks after ${and(u.pets.map((p) => p.name))} for ${and([...new Set(u.pets.map((p) => p.owner_name))])}`
        : 'no pets yet'
  return (
    <button className={`person-card is-${u.role}`} onClick={onPick} aria-label={`Use Tended as ${u.name}, ${roleLabel(u).toLowerCase()} in ${u.city}`}>
      <span className="person-top">
        <PersonAvatar user={u} size={52} />
        <span className="person-id">
          <b>
            {u.name}
            {!u.is_sample && <RealBadge sample={false} />}
          </b>
          <span>
            {[u.city, u.country].filter(Boolean).join(', ')} {u.flag}
          </span>
        </span>
        <span className="person-go" aria-hidden>
          ›
        </span>
      </span>
      <span className="person-route">
        {u.name} · {u.city} {u.flag} <span aria-hidden>→</span> {route}
      </span>
      {u.pets.length > 0 && (
        <span className="person-pets">
          {u.pets.map((p) => (
            <span key={p.id} className="person-pet">
              {p.photo_url ? <img src={p.photo_url} alt="" /> : <span className="person-pet-blank" />}
              <span>
                <b>{p.name}</b> {p.home_city} {p.home_flag}
              </span>
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

/** "New here? Create your profile": name, city and time zone, role, an optional photo. No password. */
function JoinForm({ onJoined, onCancel }: { onJoined: (u: User) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [timezone, setTimezone] = useState(browserTz)
  const [role, setRole] = useState<Role>('owner')
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onJoined(await api.join({ name, city, timezone, role, photo }))
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form className="card form join-form" onSubmit={submit}>
      <h2>Create your profile</h2>
      <p className="muted small">
        No password. You'll only see your own pets. {role === 'owner' ? 'Next you can add a pet and its caretaker.' : 'An owner can add you as their caretaker.'}
      </p>
      <Group label="I'm a…">
        <Segmented<Role>
          value={role}
          onChange={setRole}
          label="Role"
          options={[
            { value: 'owner', label: 'Pet owner' },
            { value: 'caretaker', label: 'Caretaker' },
          ]}
        />
      </Group>
      <div className="grid-2">
        <Field label="Name *">
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field label="City *">
          <input required maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Where are you?" />
        </Field>
        <Field label="Time zone">
          <ZoneSelect value={timezone} onChange={setTimezone} />
        </Field>
        <Field label="Photo (optional)">
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="btn primary" disabled={saving}>
          {saving ? 'Creating…' : 'Create profile'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
