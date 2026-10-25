import { useEffect, useRef, useState } from 'react'
import { api, forgetJoined, type User } from './api'

// People who join can add a photo; demo people (and anyone without one) get a
// drawn avatar: their initial on a tint.
const TINT: Record<string, string> = {
  joana: 'var(--peach)',
  maya: 'var(--lilac)',
  kenji: 'var(--mint)',
  ama: 'var(--sky)',
  lena: 'var(--mint)',
  yuki: 'var(--peach)',
}

export function PersonAvatar({ user, size = 40 }: { user: Pick<User, 'id' | 'name'> & { photo_url?: string | null }; size?: number }) {
  if (user.photo_url) {
    return <img className="person-avatar" src={user.photo_url} alt="" style={{ width: size, height: size }} />
  }
  return (
    <span
      className="person-avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: TINT[user.id] ?? 'var(--soft)' }}
      aria-hidden
    >
      {user.name.slice(0, 1)}
    </span>
  )
}

export const roleLabel = (u: User) => (u.role === 'owner' ? 'Pet owner' : 'Caretaker')

/** "Sample" for the demo data, "Real user" for people and pets added by testers. */
export function RealBadge({ sample }: { sample: boolean }) {
  return <span className={`badge ${sample ? 'sample' : 'real'}`}>{sample ? 'Sample' : 'Real user'}</span>
}

/** The small round profile photo in the top bar: who you are, "Switch user", and
 *  (for people who joined) "Delete my profile and pets". */
export function ProfileMenu({ user, onAddPet, onSwitch, onDeleted }: {
  user: User
  onAddPet?: () => void
  onSwitch: () => void
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="profile-menu-wrap" ref={ref}>
      <button className="profile-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`${user.name}: account menu`} onClick={() => setOpen(!open)}>
        <PersonAvatar user={user} size={40} />
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-menu-head">
            <PersonAvatar user={user} size={52} />
            <div>
              <p className="profile-name">{user.name}</p>
              <p className="profile-role">{roleLabel(user)}</p>
              <p className="profile-city">
                {[user.city, user.country].filter(Boolean).join(', ')} {user.flag}
              </p>
            </div>
          </div>
          {user.note && <p className="muted small profile-note">{user.note}</p>}
          <RealBadge sample={user.is_sample} />
          {onAddPet && (
            <button
              className="btn ghost"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onAddPet()
              }}
            >
              + Add a pet
            </button>
          )}
          <button className="btn primary" role="menuitem" onClick={onSwitch}>
            Switch user
          </button>
          {!user.is_sample && (
            <button
              className="btn danger-link"
              role="menuitem"
              onClick={async () => {
                const what = user.role === 'owner' ? 'your profile, your pets, everything logged for them, and the caretakers you added' : 'your profile'
                if (!confirm(`Delete ${what}? This can't be undone.`)) return
                try {
                  await api.deleteMe()
                  forgetJoined(user.id)
                  onDeleted()
                } catch (e) {
                  alert((e as Error).message)
                }
              }}
            >
              Delete my profile and pets
            </button>
          )}
        </div>
      )}
    </div>
  )
}
