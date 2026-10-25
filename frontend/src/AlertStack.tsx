import { useState } from 'react'
import { Icon, TOPIC_ICON } from './Icons'
import { stamp, timeIn } from './time'

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

function when(a: AlertItem, tz: string): string {
  if (!a.at) return ''
  if (a.kind?.startsWith('appointment')) return stamp(a.at, tz)
  if (a.kind === 'health') return `logged ${timeIn(new Date(a.at), tz)}`
  return `due ${timeIn(new Date(a.at), tz)}`
}

/** A neat stack of short, friendly alerts. */
export function AlertStack({ alerts, tz, emptyText }: { alerts: AlertItem[]; tz: string; emptyText?: string }) {
  const [showAll, setShowAll] = useState(false)
  if (!alerts.length) {
    return emptyText ? (
      <p className="all-clear">
        <Icon name="check" size={18} /> {emptyText}
      </p>
    ) : null
  }
  const sorted = alerts.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level])
  const shown = showAll ? sorted : sorted.slice(0, SHOW_FIRST)
  const urgent = sorted.filter((a) => a.level === 'urgent').length
  return (
    <section className="alert-stack" aria-label="Alerts">
      <header className="alert-stack-head">
        <h2>
          {sorted.length === 1 ? '1 thing needs attention' : `${sorted.length} things need attention`}
        </h2>
        {urgent > 0 && <span className="lvl-pill lvl-urgent">{urgent} urgent</span>}
      </header>
      <ul>
        {shown.map((a, i) => (
          <AlertCard key={`${a.source}-${a.headline}-${i}`} a={a} tz={tz} />
        ))}
      </ul>
      {sorted.length > SHOW_FIRST && (
        <button className="link-btn stack-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
        </button>
      )}
    </section>
  )
}

function AlertCard({ a, tz }: { a: AlertItem; tz: string }) {
  const [open, setOpen] = useState(false)
  const time = when(a, tz)
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
