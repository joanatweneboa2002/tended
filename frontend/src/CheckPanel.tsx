import { useCallback, useEffect, useState } from 'react'
import { api, formatDate, type CheckRun, type LogSuggestionItem, type Pet, type WatchAlert } from './api'
import { AgentBadge, agentInfo } from './agents'
import { stamp } from './time'

const LEVEL_LABEL = { urgent: 'Urgent', watch: 'Watch', fyi: 'FYI' }

/** Owner: latest check (urgent alerts on top, summary, other alerts) + Run check. */
export function useLatestCheck(petId: number) {
  const [check, setCheck] = useState<CheckRun | null | undefined>(undefined)
  const load = useCallback(() => {
    api.latestCheck(petId).then(setCheck, () => setCheck(null))
  }, [petId])
  useEffect(load, [load])
  return { check, setCheck, reload: load }
}

export function UrgentWatch({ check }: { check: CheckRun | null | undefined }) {
  const urgent = check?.alerts.filter((a) => a.level === 'urgent') ?? []
  if (!urgent.length) return null
  return (
    <section className="watch-urgent" aria-label="Urgent alerts from the Watchdog">
      {urgent.map((a, i) => (
        <article key={i} className="watch-urgent-item" role="alert">
          <p className="wu-kicker">
            <AgentBadge agent="watchdog" size={22} /> Urgent · Watchdog
          </p>
          <h2>{a.title}</h2>
          <p>{a.noticed}</p>
          <p className="wu-action">→ {a.action}</p>
          <Refs alert={a} light />
        </article>
      ))}
    </section>
  )
}

export function CheckCard({
  pet,
  check,
  onCheck,
  onOpenActivity,
}: {
  pet: Pet
  check: CheckRun | null | undefined
  onCheck: (c: CheckRun) => void
  onOpenActivity: () => void
}) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tz = pet.owner_timezone
  const summaryInfo = agentInfo('daily_summary')

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      onCheck(await api.runCheck(pet.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="card check-card" style={{ ['--agent' as string]: summaryInfo.color, ['--agent-soft' as string]: summaryInfo.soft }}>
      <div className="tile-head">
        <h2>
          <AgentBadge agent="daily_summary" size={28} /> Today's summary
        </h2>
        <button className="link-btn" onClick={onOpenActivity}>
          Activity ›
        </button>
      </div>

      {running ? (
        <div className="thinking" role="status">
          <span className="dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <p>
            Watchdog is reading the last 7 days, then the summary gets written…{' '}
            <button className="link-btn" onClick={onOpenActivity}>
              Watch it work
            </button>
          </p>
        </div>
      ) : check?.summary ? (
        <>
          <p className="summary-text">{check.summary.summary}</p>
          <p className="muted small">Written {stamp(check.summary.written_at, tz)}</p>
        </>
      ) : (
        <p className="muted">
          No summary yet. Run a check to have the Watchdog look over the last 7 days and get a short update on {pet.name}'s
          day.
        </p>
      )}

      {!running && check && check.status !== 'done' && check.message && (
        <p className={`check-msg ${check.status}`}>⚠️ {check.message}</p>
      )}
      {!running && check && check.suspicious.length > 0 && (
        <p className="check-suspicious">
          🛡️ {check.suspicious.length} message{check.suspicious.length !== 1 ? 's' : ''} tried to give Tended instructions (
          “{check.suspicious[0].text.slice(0, 60)}
          {check.suspicious[0].text.length > 60 ? '…' : ''}”). Ignored and flagged.{' '}
          <button className="link-btn" onClick={onOpenActivity}>
            See activity
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="check-foot">
        <button className="btn primary" onClick={run} disabled={running}>
          {running ? 'Checking…' : check ? 'Run check again' : 'Run check'}
        </button>
        {check && !running && (
          <span className="muted small">
            Last check {stamp(check.created_at, tz)} · {check.budget.calls}/{check.budget.max_calls} AI calls ·{' '}
            {check.budget.tokens.toLocaleString()}/{check.budget.max_tokens.toLocaleString()} tokens
          </span>
        )}
      </div>
    </section>
  )
}

export function WatchList({ check }: { check: CheckRun | null | undefined }) {
  const rest = check?.alerts.filter((a) => a.level !== 'urgent') ?? []
  if (!check) return null
  const info = agentInfo('watchdog')
  return (
    <section className="card watch-list" style={{ ['--agent' as string]: info.color, ['--agent-soft' as string]: info.soft }}>
      <div className="tile-head">
        <h2>
          <AgentBadge agent="watchdog" size={28} /> Watchdog
        </h2>
        <span className="muted small">
          {check.alerts.length} alert{check.alerts.length !== 1 ? 's' : ''} from the last check
        </span>
      </div>
      {rest.length === 0 ? (
        <p className="muted small">
          {check.alerts.length ? 'Only the urgent alerts above.' : 'Nothing flagged in the last check.'}
        </p>
      ) : (
        <ul className="watch-items">
          {rest.map((a, i) => (
            <li key={i} className={`watch-item lvl-${a.level}`}>
              <span className={`lvl-chip lvl-${a.level}`}>{LEVEL_LABEL[a.level]}</span>
              <div>
                <strong>{a.title}</strong>
                <p className="small">{a.noticed}</p>
                <p className="small wi-action">→ {a.action}</p>
                <Refs alert={a} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Refs({ alert, light = false }: { alert: WatchAlert; light?: boolean }) {
  if (!alert.references.length) return null
  return (
    <p className={`refs ${light ? 'light' : ''}`}>
      {alert.references.map((r) => (
        <span key={r.id} className="source-chip src-reference">
          📚 {r.topic} <em>({r.source})</em>
        </span>
      ))}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Caretaker: approve health-log entries the Watchdog spotted in messages
// ---------------------------------------------------------------------------

const FIELD_LABEL: Record<string, string> = {
  appetite: 'Appetite',
  energy: 'Energy',
  water: 'Water',
  potty: 'Potty',
  weight: 'Weight',
  symptoms: 'Notes',
}

export function SuggestionsCard({ pet }: { pet: Pet }) {
  const [items, setItems] = useState<LogSuggestionItem[]>([])
  const [done, setDone] = useState<Record<number, 'approved' | 'dismissed'>>({})
  const [error, setError] = useState<string | null>(null)
  const info = agentInfo('watchdog')

  useEffect(() => {
    api.logSuggestions(pet.id).then(setItems, () => {})
  }, [pet.id])

  const decide = async (s: LogSuggestionItem, approve: boolean) => {
    setError(null)
    try {
      const r = approve ? await api.approveSuggestion(s.id) : await api.dismissSuggestion(s.id)
      setDone((d) => ({ ...d, [s.id]: r.status as 'approved' | 'dismissed' }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!items.length) return null
  return (
    <section className="card suggestions" style={{ ['--agent' as string]: info.color, ['--agent-soft' as string]: info.soft }}>
      <div className="tile-head">
        <h2>
          <AgentBadge agent="watchdog" size={28} /> Log this?
        </h2>
        <span className="muted small">Spotted in your messages. Nothing is logged unless you say yes.</span>
      </div>
      <ul className="sugg-list">
        {items.map((s) => (
          <li key={s.id} className={`sugg ${done[s.id] ?? 'pending'}`}>
            <p className="sugg-quote">
              “{s.quote}” <span className="muted small">· {formatDate(s.log_date)}</span>
            </p>
            <div className="health-chips">
              {Object.entries(s.fields).map(([k, v]) => (
                <span key={k} className="chip">
                  <b>{FIELD_LABEL[k] ?? k}</b> {String(v)}
                </span>
              ))}
            </div>
            {done[s.id] ? (
              <p className="item-state approved">{done[s.id] === 'approved' ? '✓ Logged' : 'Dismissed, nothing logged'}</p>
            ) : (
              <div className="item-actions">
                <button className="btn primary small" onClick={() => decide(s, true)}>
                  ✓ Yes, log it
                </button>
                <button className="btn soft small" onClick={() => decide(s, false)}>
                  No
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
