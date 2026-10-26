import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  api,
  joinedHere,
  rememberJoined,
  signIn,
  type ApiError,
  type Invite,
  type InviteCheck,
  type Pet,
  type PetBrief,
  type User,
} from './api'
import { PawDoodle } from './Doodles'
import { InviteCard } from './Invite'
import { PersonAvatar, roleLabel } from './People'
import { browserTz, ZoneSelect } from './Profile'
import { Field } from './ui'

type Person = User & { pets: PetBrief[] }
type Screen = 'landing' | 'owner' | 'caretaker' | 'pick' | 'demo'

const COLLAGE = ['/pets/fynn.jpg', '/pets/miso.jpg', '/pets/kiwi.jpg', '/pets/clover.jpg', '/pets/happy-dog.jpg']

const backendError = (e: unknown) =>
  (e as ApiError).status === 404
    ? 'The backend is running an older version of Tended. Restart it (./dev.sh) and refresh.'
    : `Can't reach the backend: ${(e as Error).message}. Is it running on port 8000?`

/** How people enter Tended: owners sign up, caretakers join with a code, returning
 *  people pick their profile, and anyone can try the demo. No passwords. */
export function Landing({ onEnter }: { onEnter: (u: User) => void }) {
  const [screen, setScreen] = useState<Screen>('landing')
  const back = () => setScreen('landing')
  const enter = (u: User) => {
    signIn(u.id)
    onEnter(u)
  }

  return (
    <div className="app landing-app">
      {screen === 'landing' && <Start go={setScreen} />}
      {screen === 'owner' && <OwnerSignup onBack={back} onDone={enter} />}
      {screen === 'caretaker' && <CaretakerJoin onBack={back} onDone={enter} />}
      {(screen === 'pick' || screen === 'demo') && <People demo={screen === 'demo'} onBack={back} onPick={enter} onSwitch={setScreen} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Landing
// ---------------------------------------------------------------------------

function Start({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="start">
      <div className="start-brand">
        <span className="brand-mark big" aria-hidden>
          <PawDoodle size={34} />
        </span>
        <h1>Tended</h1>
        <p>Care for your pet while you’re away</p>
      </div>
      <div className="collage" aria-hidden>
        {COLLAGE.map((src, i) => (
          <img key={src} src={src} alt="" className={`collage-${i}`} />
        ))}
      </div>
      <div className="start-links">
        <button className="link-btn" onClick={() => go('pick')}>
          Already on Tended? Pick your profile
        </button>
        <button className="link-btn" onClick={() => go('demo')}>
          Just looking? Try the demo
        </button>
      </div>
    </div>
  )
}

function Flow({ title, sub, onBack, children }: { title: string; sub?: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="flow">
      <button className="link-btn flow-back" onClick={onBack}>
        ‹ Back
      </button>
      <div className="welcome-hero">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function Dots({ step, labels }: { step: number; labels: string[] }) {
  return (
    <ol className="dots-row" aria-label={`Step ${step + 1} of ${labels.length}`}>
      {labels.map((l, i) => (
        <li key={l} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="dot" aria-hidden />
          <span>{l}</span>
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// 2. Owner sign up: you, your pet, your caretaker
// ---------------------------------------------------------------------------

function OwnerSignup({ onBack, onDone }: { onBack: () => void; onDone: (u: User) => void }) {
  const [step, setStep] = useState(0)
  const [me, setMe] = useState<User | null>(null)
  const [pet, setPet] = useState<Pet | null>(null)
  const [invite, setInvite] = useState<Invite | null>(null)

  return (
    <Flow title="Welcome to Tended" sub="Three quick steps, no password." onBack={onBack}>
      <Dots step={step} labels={['You', 'Your pet', 'Your caretaker']} />
      {step === 0 && (
        <YouStep
          onSaved={(u) => {
            signIn(u.id) // the next steps act as this owner
            rememberJoined(u.id)
            setMe(u)
            setStep(1)
          }}
        />
      )}
      {step === 1 && me && (
        <PetStep
          onSaved={(p) => {
            setPet(p)
            setStep(2)
          }}
        />
      )}
      {step === 2 && me && pet && (
        <section className="card form">
          {invite ? (
            <>
              <h2>Send this to {invite.caretaker_name || 'your caretaker'}</h2>
              <InviteCard invite={invite} />
              <button className="btn primary big" onClick={() => onDone(me)}>
                Go to {pet.name}’s Home
              </button>
            </>
          ) : (
            <CaretakerStep pet={pet} onInvite={setInvite} onSkip={() => onDone(me)} />
          )}
        </section>
      )}
    </Flow>
  )
}

function YouStep({ onSaved }: { onSaved: (u: User) => void }) {
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [timezone, setTimezone] = useState(browserTz)
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.join({ name, city, timezone, role: 'owner', photo }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>About you</h2>
      <div className="grid-2">
        <Field label="Your name *">
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field label="Your city *">
          <input required maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Where are you?" />
        </Field>
        <Field label="Your time zone (detected, change if needed)">
          <ZoneSelect value={timezone} onChange={setTimezone} />
        </Field>
        <Field label="Photo (optional)">
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary big" disabled={busy}>
        {busy ? 'Saving…' : 'Next: your pet'}
      </button>
    </form>
  )
}

function PetStep({ onSaved }: { onSaved: (p: Pet) => void }) {
  const [f, setF] = useState({ name: '', species: '', breed: '', age: '', city: '', tz: browserTz() })
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let p = await api.createPet({
        name: f.name, species: f.species, breed: f.breed, age_years: f.age.trim() ? Number(f.age) : null,
        weight: null, weight_unit: 'lb', quirks: '', home_timezone: f.tz, home_city: f.city,
        caretaker_id: null, caretaker_name: '',
      })
      if (photo) p = await api.uploadPetPhoto(p.id, photo)
      onSaved(p)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Your pet</h2>
      <div className="grid-2">
        <Field label="Name *">
          <input required maxLength={80} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Species *">
          <input required value={f.species} onChange={(e) => set('species', e.target.value)} placeholder="Cat, dog, rabbit…" />
        </Field>
        <Field label="Breed">
          <input value={f.breed} onChange={(e) => set('breed', e.target.value)} />
        </Field>
        <Field label="Age (years)">
          <input type="number" min={0} step="0.5" value={f.age} onChange={(e) => set('age', e.target.value)} />
        </Field>
        <Field label="Photo (optional)">
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="City where they're staying *">
          <input required maxLength={80} value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="Where is your pet?" />
        </Field>
        <Field label="Their time zone">
          <ZoneSelect value={f.tz} onChange={(v) => set('tz', v)} />
        </Field>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary big" disabled={busy}>
        {busy ? 'Saving…' : 'Next: your caretaker'}
      </button>
    </form>
  )
}

function CaretakerStep({ pet, onInvite, onSkip }: { pet: Pet; onInvite: (i: Invite) => void; onSkip: () => void }) {
  const [name, setName] = useState('')
  const [city, setCity] = useState(pet.home_city)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onInvite(await api.createInvite(pet.id, { name, city }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <form className="form" onSubmit={submit}>
      <h2>Who’s looking after {pet.name}?</h2>
      <p className="muted small">You’ll get a code to send them. They use it to join, and they’ll only see {pet.name}.</p>
      <div className="grid-2">
        <Field label="Their name *">
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Their city *">
          <input required maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary big" disabled={busy}>
        {busy ? 'Making a code…' : 'Get an invite code'}
      </button>
      <button type="button" className="link-btn" onClick={onSkip}>
        Skip for now (invite them later from {pet.name}’s profile)
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 3. Caretaker join: the code from the owner
// ---------------------------------------------------------------------------

function CaretakerJoin({ onBack, onDone }: { onBack: () => void; onDone: (u: User) => void }) {
  const [code, setCode] = useState('')
  const [found, setFound] = useState<InviteCheck | null>(null)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Show which pet a full-looking code is for (nothing is used up yet).
  useEffect(() => {
    setFound(null)
    if (!/^[A-Za-z]+-[A-Za-z0-9]{4}$/.test(code.trim())) return
    let live = true
    api.checkInvite(code).then(
      (c) => {
        if (!live) return
        setFound(c)
        setError(null)
        setName((n) => n || c.caretaker_name)
        setCity((x) => x || c.caretaker_city || c.home_city)
      },
      (e) => live && setError((e as Error).message),
    )
    return () => {
      live = false
    }
  }, [code])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const u = await api.joinPet({ code, name, city, photo })
      rememberJoined(u.id)
      onDone(u)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Flow title="Join a pet" sub="Enter the code from the owner. No password needed." onBack={onBack}>
      <form className="card form" onSubmit={submit}>
        <Field label="Code from the owner *">
          <input
            required
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="FYNN-K7P2"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {found && (
          <p className="invite-found">
            {found.pet_photo_url && <img src={found.pet_photo_url} alt="" />}
            <span>
              This code is for <b>{found.pet_name}</b> in {found.home_city} {found.home_flag}, {found.owner_name}’s pet.
            </span>
          </p>
        )}
        <div className="grid-2">
          <Field label="Your name *">
            <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Your city *">
            <input required maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Photo (optional)">
            <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary big" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>
    </Flow>
  )
}

// ---------------------------------------------------------------------------
// 4. Returning (people who joined on this device) and the demo people
// ---------------------------------------------------------------------------

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

function People({ demo, onBack, onPick, onSwitch }: { demo: boolean; onBack: () => void; onPick: (u: User) => void; onSwitch: (s: Screen) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.users().then(setPeople, (e) => setError(backendError(e)))
  }, [])
  const here = joinedHere()
  const list = people?.filter((u) => (demo ? u.is_sample : !u.is_sample && here.includes(u.id))) ?? []
  const section = (title: string, ps: Person[]) =>
    ps.length > 0 && (
      <section className="people-section">
        <h2>{title}</h2>
        <ul className="people">
          {ps.map((u) => (
            <li key={u.id}>
              <PersonCard u={u} demo={demo} onPick={() => onPick(u)} />
            </li>
          ))}
        </ul>
      </section>
    )
  return (
    <Flow
      title={demo ? 'Try the demo' : 'Pick your profile'}
      sub={demo ? 'Demo people in different places. Pick someone to see Tended through their eyes.' : 'People who joined on this device.'}
      onBack={onBack}
    >
      {error && <p className="error">{error}</p>}
      {people && !demo && list.length === 0 && (
        <div className="card empty-join">
          <p>No one has joined on this device yet.</p>
          <div className="form-actions center">
            <button className="btn primary" onClick={() => onSwitch('owner')}>
              I own a pet
            </button>
            <button className="btn ghost" onClick={() => onSwitch('caretaker')}>
              I’m looking after a pet
            </button>
          </div>
        </div>
      )}
      <div className="people-columns">
        {section('Pet owners', list.filter((u) => u.role === 'owner'))}
        {section('Caretakers', list.filter((u) => u.role === 'caretaker'))}
      </div>
      {demo && <p className="demo-note">Demo accounts for testing, no password needed.</p>}
    </Flow>
  )
}

function PersonCard({ u, demo, onPick }: { u: Person; demo: boolean; onPick: () => void }) {
  const route =
    u.role === 'owner'
      ? u.pets.length
        ? petsAndPlaces(u.pets)
        : 'no pets yet'
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
            <span className={`badge ${demo ? 'demo' : 'real'}`}>{demo ? 'Demo' : 'Real user'}</span>
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
