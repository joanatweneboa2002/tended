import { useCallback, useEffect, useState } from 'react'
import { api, formatDate, type CheckRun, type LogSuggestionItem, type Pet } from './api'
import { agentInfo } from './agents'
import { IconCircle } from './Icons'
import { PetAvatar } from './PetAvatar'
import { stampFor } from './time'
import { When } from './ui'

/** Owner: latest check (urgent alerts on top, summary, other alerts) + Run check. */
export function useLatestCheck(petId: number) {
  const [check, setCheck] = useState<CheckRun | null | undefined>(undefined)
  const load = useCallback(() => {
    api.latestCheck(petId).then(setCheck, () => setCheck(null))
  }, [petId])
  useEffect(load, [load])
  return { check, setCheck, reload: load }
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
  const [more, setMore] = useState(false)
  const summaryInfo = agentInfo('daily_summary')
  const long = (check?.summary?.summary.length ?? 0) > 220 // about 4 lines on a phone

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
    <section className="card note-card" style={{ ['--agent' as string]: summaryInfo.color, ['--agent-soft' as string]: summaryInfo.soft }}>
      <div className="note-head">
        <PetAvatar pet={pet} size={40} />
        <div>
          <h2>A note from Tended</h2>
          <p className="muted small">
            {check?.summary ? <When t={stampFor(check.summary.written_at, pet, 'owner')} /> : `Today's summary for ${pet.name}`}
          </p>
        </div>
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
          <p className={`summary-text ${long && !more ? 'clamped' : ''}`}>{check.summary.summary}</p>
          {long && (
            <button className="link-btn read-more" onClick={() => setMore(!more)} aria-expanded={more}>
              {more ? 'Show less' : 'Read more'}
            </button>
          )}
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
            Last check <When t={stampFor(check.created_at, pet, 'owner')} /> · {check.budget.calls}/{check.budget.max_calls} AI calls ·{' '}
            {check.budget.tokens.toLocaleString()}/{check.budget.max_tokens.toLocaleString()} tokens
          </span>
        )}
      </div>
    </section>
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
    <section className="card suggestions tint-coral" style={{ ['--agent' as string]: info.color, ['--agent-soft' as string]: info.soft }}>
      <div className="tile-head">
        <h2>
          <IconCircle name="clipboard" tone="coral" size={38} /> Log this?
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
