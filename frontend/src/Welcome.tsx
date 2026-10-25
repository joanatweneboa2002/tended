import { useEffect, useState } from 'react'
import { api, type PetBrief, type User } from './api'
import { PawDoodle } from './Doodles'
import { PersonAvatar, roleLabel } from './People'

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

  useEffect(() => {
    api.users().then(setPeople, (e) => setError(`Can't reach the backend: ${(e as Error).message}. Is it running on port 8000?`))
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
      </div>
      {error && <p className="error">{error}</p>}
      {people && section('Pet owners', people.filter((u) => u.role === 'owner'))}
      {people && section('Caretakers', people.filter((u) => u.role === 'caretaker'))}
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
          <b>{u.name}</b>
          <span>
            {u.city}, {u.country} {u.flag}
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
