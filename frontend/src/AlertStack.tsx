import { useState } from 'react'
import type { Pet, Role } from './api'
import { Icon, TOPIC_ICON } from './Icons'
import { stampFor, type Shown } from './time'

export type Level = 'urgent' | 'watch' | 'fyi'

export interface AlertItem {
  level: Level
  topic?: string
  headline: string
  action: string
  details?: string
  at?: string | null
  kind?: string
  references?: { id: string; topic: string; source: string }[]
  source: string // "Watchdog" | "Today"
}

const LEVEL_WORD: Record<Level, string> = { urgent: 'Urgent', watch: 'Watch', fyi: 'FYI' }
const ORDER: Record<Level, number> = { urgent: 0, watch: 1, fyi: 2 }
const SHOW_FIRST = 3

function when(a: AlertItem, pet: Pet, role: Role): string {
  if (!a.at) return ''
  const appt = a.kind?.startsWith('appointment')
  const t: Shown = stampFor(a.at, pet, role, appt)
  const text = t.yours ? `${t.main} (${t.yours} for you)` : t.main
  return appt ? text : a.kind === 'health' ? `logged ${text}` : `due ${text}`
}

/** The attention strip: one lilac card ("3 things need attention" + the top
 *  headline); the chevron opens the full stack of alert cards. */
export function AlertStack({ alerts, pet, role, emptyText }: { alerts: AlertItem[]; pet: Pet; role: Role; emptyText?: string }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  if (!alerts.length) {
    return emptyText ? (
      <div className="all-clear">
        <img src="/pets/napping-cat.jpg" alt="" className="all-clear-photo" />
        <p>
          <b>{emptyText}</b>
          <span className="muted small">Nap time.</span>
        </p>
      </div>
    ) : null
  }
  const sorted = alerts.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level])
  const top = sorted[0]
  const urgent = sorted.filter((a) => a.level === 'urgent').length
  const shown = showAll ? sorted : sorted.slice(0, SHOW_FIRST)
  const n = sorted.length
  return (
    <section className={`alert-drop lvl-${top.level} ${open ? 'open' : ''}`} aria-label="Alerts">
      <button className="alert-bar" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="alert-bar-icon" aria-hidden>
          <Icon name={TOPIC_ICON[top.topic ?? 'other'] ?? 'paw'} size={20} />
        </span>
        <span className="alert-bar-text">
          <b>
            {n} need{n === 1 ? 's' : ''} attention
          </b>
          <span className="alert-bar-top">
            {urgent > 0 && <span className="urgent-inline">{urgent} urgent · </span>}
            {top.headline}
          </span>
        </span>
        {urgent > 0 && <span className="lvl-pill lvl-urgent">{urgent} urgent</span>}
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="alert-drop-body">
          <ul>
            {shown.map((a, i) => (
              <AlertCard key={`${a.source}-${a.headline}-${i}`} a={a} pet={pet} role={role} />
            ))}
          </ul>
          {sorted.length > SHOW_FIRST && (
            <button className="link-btn stack-more" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function AlertCard({ a, pet, role }: { a: AlertItem; pet: Pet; role: Role }) {
  const [open, setOpen] = useState(false)
  const time = when(a, pet, role)
  const hasMore = Boolean(a.details || a.references?.length || time)
  return (
    <li className={`alert-card lvl-${a.level}`}>
      <span className="alert-icon-circle" aria-hidden>
        <Icon name={TOPIC_ICON[a.topic ?? 'other'] ?? 'paw'} size={20} />
      </span>
      <div className="alert-text">
        <p className="alert-meta">
          <span className={`lvl-pill lvl-${a.level}`}>{LEVEL_WORD[a.level]}</span>
          <span className="muted">{a.source}</span>
        </p>
        <p className="alert-headline">{a.headline}</p>
        <p className="alert-action">{a.action}</p>
        {hasMore && (
          <button className="link-btn see-why" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'See why'}
          </button>
        )}
        {open && (
          <div className="alert-details">
            {time && <p className="muted small">{time.charAt(0).toUpperCase() + time.slice(1)}</p>}
            {a.details && <p>{a.details}</p>}
            {!!a.references?.length && (
              <p className="refs">
                {a.references.map((r) => (
                  <span key={r.id} className="source-chip src-reference">
                    📚 {r.topic} <em>({r.source})</em>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
