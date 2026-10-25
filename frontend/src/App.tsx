import { useCallback, useEffect, useState } from 'react'
import { api, type Pet, type Role } from './api'
import { Appointments } from './Appointments'
import { AgentActivity } from './AgentActivity'
import { PawDoodle } from './Doodles'
import { EmergencyButton } from './EmergencyCard'
import { Health } from './Health'
import { Home, type Tab } from './Home'
import { Messages } from './Messages'
import { PetAvatar } from './PetAvatar'
import { Profile, ProfileForm } from './Profile'
import { Schedule } from './Schedule'

const VIEW_KEY = 'tended.view'
const PET_KEY = 'tended.petId'
const UNREAD_POLL_MS = 5000

const TABS: { id: Exclude<Tab, 'profile'>; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'health', label: 'Health' },
  { id: 'messages', label: 'Messages' },
  { id: 'appointments', label: 'Appointments' },
]

const PAGE_TITLE: Record<Tab, string> = {
  home: 'Home',
  schedule: 'Schedule',
  health: 'Health',
  messages: 'Messages',
  appointments: 'Appointments',
  profile: 'Profile',
}

export default function App() {
  const [role, setRole] = useState<Role>(() => (localStorage.getItem(VIEW_KEY) === 'owner' ? 'owner' : 'caretaker'))
  const [pets, setPets] = useState<Pet[] | null>(null)
  const [petId, setPetId] = useState<number | null>(() => Number(localStorage.getItem(PET_KEY)) || null)
  const [tab, setTab] = useState<Tab>('home')
  const [adding, setAdding] = useState(false)
  const [unread, setUnread] = useState(0)
  const [activityOpen, setActivityOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPets = useCallback(async (selectId?: number) => {
    try {
      const list = await api.pets()
      setPets(list)
      setError(null)
      setPetId((cur) => {
        const want = selectId ?? cur
        return list.some((p) => p.id === want) ? want! : (list[0]?.id ?? null)
      })
    } catch (e) {
      setError(`Can't reach the backend: ${(e as Error).message}. Is it running on port 8000?`)
    }
  }, [])

  useEffect(() => {
    loadPets()
  }, [loadPets])
  useEffect(() => localStorage.setItem(VIEW_KEY, role), [role])
  useEffect(() => {
    if (petId !== null) localStorage.setItem(PET_KEY, String(petId))
  }, [petId])

  // Unread badge: not live, just checked every few seconds.
  useEffect(() => {
    if (petId === null) return
    let cancelled = false
    const check = () =>
      api.unread(petId, role).then(
        (r) => !cancelled && setUnread(r.unread),
        () => {},
      )
    check()
    const id = setInterval(check, UNREAD_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [petId, role])
  const clearUnread = useCallback(() => setUnread(0), [])

  const pet = pets?.find((p) => p.id === petId) ?? null

  const go = (t: Tab) => {
    setAdding(false)
    setTab(t)
    window.scrollTo({ top: 0 })
  }

  const resetSamples = async () => {
    if (!confirm('Re-create the two sample pets with a fresh sample week? Changes to them will be lost. Your own pets are not touched.')) return
    await api.resetSamples()
    await loadPets()
    go('home')
  }

  return (
    <div className={`app view-${role}`}>
      <header className="app-top">
        <div className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden>
              <PawDoodle size={20} />
            </span>
            <span className="brand-name">Tended</span>
          </div>
          <div className="topbar-right">
            {role === 'owner' && pet && <AgentActivity pet={pet} open={activityOpen} onOpenChange={setActivityOpen} />}
            <div className="view-switch" role="tablist" aria-label="View">
              {(['owner', 'caretaker'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={role === v} className={role === v ? 'active' : ''} onClick={() => setRole(v)}>
                  {v === 'owner' ? 'Owner' : 'Caretaker'}
                </button>
              ))}
            </div>
            <EmergencyButton petId={petId} />
          </div>
        </div>

        {pets && pets.length > 0 && (
          <nav className="pet-pills" aria-label="Your pets">
            {pets.map((p) => (
              <button
                key={p.id}
                className={`pet-pill ${p.id === petId && !adding ? 'active' : ''}`}
                onClick={() => {
                  setPetId(p.id)
                  setAdding(false)
                }}
                aria-current={p.id === petId ? 'true' : undefined}
              >
                <PetAvatar pet={p} size={30} />
                <span>{p.name}</span>
              </button>
            ))}
            {role === 'owner' && (
              <button className={`pet-pill add ${adding ? 'active' : ''}`} onClick={() => setAdding(true)}>
                <span className="add-plus" aria-hidden>
                  +
                </span>
                <span>Add pet</span>
              </button>
            )}
          </nav>
        )}

        {pet && !adding && tab !== 'home' && (
          <section className="page-head">
            <div className="page-head-text">
              <h1>{PAGE_TITLE[tab]}</h1>
              <p>
                {pet.name}
                {[pet.species, pet.breed].filter(Boolean).length > 0 && ` · ${[pet.species, pet.breed].filter(Boolean).join(' · ')}`}
                {pet.is_sample && <span className="badge sample">Sample</span>}
              </p>
            </div>
            <button className="page-head-photo" onClick={() => go('profile')} aria-label={`Open ${pet.name}'s profile`}>
              <PetAvatar pet={pet} size={72} />
            </button>
          </section>
        )}
      </header>

      <main>
        {error && <p className="error card">{error}</p>}
        {adding ? (
          <ProfileForm
            pet={null}
            onSaved={(p) => {
              setAdding(false)
              loadPets(p.id)
              go('home')
            }}
            onCancel={() => setAdding(false)}
          />
        ) : pet ? (
          <div key={`${pet.id}-${role}`}>
            {tab === 'home' && <Home pet={pet} role={role} go={go} onOpenActivity={() => setActivityOpen(true)} />}
            {tab === 'schedule' && <Schedule pet={pet} role={role} onOpenActivity={() => setActivityOpen(true)} />}
            {tab === 'health' && <Health pet={pet} role={role} />}
            {tab === 'messages' && <Messages pet={pet} role={role} onRead={clearUnread} />}
            {tab === 'appointments' && <Appointments pet={pet} role={role} />}
            {tab === 'profile' && (
              <Profile
                pet={pet}
                role={role}
                onPetChanged={(p) => setPets((list) => list?.map((x) => (x.id === p.id ? p : x)) ?? null)}
                onPetDeleted={() => {
                  loadPets()
                  go('home')
                }}
                onResetSamples={resetSamples}
              />
            )}
          </div>
        ) : (
          pets && (
            <div className="empty card">
              <p>No pets yet.</p>
              <div className="form-actions center">
                <button
                  className="btn primary"
                  onClick={() => {
                    setRole('owner')
                    setAdding(true)
                  }}
                >
                  Add a pet
                </button>
                <button className="btn ghost" onClick={resetSamples}>
                  Load sample pets
                </button>
              </div>
            </div>
          )
        )}
      </main>

      {pet?.is_sample && !adding && (
        <footer className="sample-note">
          {pet.name} is <strong>sample data</strong> for trying out Tended. Names, phone numbers and addresses are made up.
        </footer>
      )}


      <nav className="bottom-nav" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id && !adding ? 'active' : ''}
            aria-current={tab === t.id && !adding ? 'page' : undefined}
            onClick={() => go(t.id)}
            disabled={!pet}
          >
            <span className="nav-icon">
              <NavIcon tab={t.id} />
              {t.id === 'messages' && unread > 0 && (
                <span className="nav-badge" aria-label={`${unread} unread`}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function NavIcon({ tab }: { tab: Exclude<Tab, 'profile'> }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (tab) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5h13V10" />
          <path d="M10 19.5v-5h4v5" />
        </svg>
      )
    case 'schedule':
      return (
        <svg {...common}>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" />
        </svg>
      )
    case 'health':
      return (
        <svg {...common}>
          <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />
          <path d="M7.5 12.5h2.5l1.2-2.2 2 4 1.3-1.8h2" />
        </svg>
      )
    case 'messages':
      return (
        <svg {...common}>
          <path d="M20 12.5a7.5 7 0 0 1-10.7 6.3L4.5 20l1.3-3.7A7 7 0 0 1 4.5 12.5 7.5 7 0 0 1 20 12.5Z" />
        </svg>
      )
    case 'appointments':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" />
          <circle cx="12" cy="14.5" r="1.6" />
        </svg>
      )
  }
}
