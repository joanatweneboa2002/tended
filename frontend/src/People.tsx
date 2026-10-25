import { useEffect, useRef, useState } from 'react'
import type { User } from './api'

// Demo people get a drawn avatar (initial on a tint) instead of a photo of a stranger.
const TINT: Record<string, string> = {
  joana: 'var(--peach)',
  maya: 'var(--lilac)',
  kenji: 'var(--mint)',
  ama: 'var(--sky)',
  lena: 'var(--mint)',
  yuki: 'var(--peach)',
}

export function PersonAvatar({ user, size = 40 }: { user: Pick<User, 'id' | 'name'>; size?: number }) {
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

/** The small round profile photo in the top bar: who you are, and "Switch user". */
export function ProfileMenu({ user, onAddPet, onSwitch }: { user: User; onAddPet?: () => void; onSwitch: () => void }) {
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
                {user.city}, {user.country} {user.flag}
              </p>
            </div>
          </div>
          {user.note && <p className="muted small profile-note">{user.note}</p>}
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
        </div>
      )}
    </div>
  )
}
