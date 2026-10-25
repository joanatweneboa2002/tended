import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type AgentEvent, type Pet } from './api'
import { AgentBadge, agentInfo } from './agents'
import { stampFor } from './time'
import { When } from './ui'

const POLL_MS = 2500

const KIND_LABEL: Record<string, string> = {
  received: 'Received',
  context: 'Read profile',
  log: 'Checked log',
  reference: 'Checked reference',
  answered: 'Answered',
  not_sure: 'Not sure',
  escalated: 'Escalated',
  messaged: 'Messaged owner',
  started: 'Started',
  step: 'Next step',
  records: 'Read records',
  findings: 'Code checks',
  suspicious: 'Suspicious input',
  suggestion: 'Log suggestion',
  alerts: 'Alerts',
  summary: 'Summary',
  stopped: 'Stopped',
  model_call: 'Model call',
  question: 'Question',
  answer: 'Your answer',
  flag: 'Flag',
  safety_check: 'Safety check',
  guardrail: 'Guardrail',
  proposal: 'Proposal',
  approved: 'Approved',
  removed: 'Removed',
  done: 'Done',
  error: 'Error',
}

/** Header button + right-hand drawer listing what each agent did, step by step. */
export function AgentActivity({ pet, open, onOpenChange }: { pet: Pet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.agentEvents(pet.id).then(
      (e) => {
        setEvents(e)
        setError(null)
      },
      (e) => setError(e.message),
    )
  }, [pet.id])

  useEffect(() => {
    if (!open) return
    load()
    const id = setInterval(load, POLL_MS)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, load, onOpenChange])

  // Group by run, newest run first; steps inside a run in the order they happened.
  const runs = useMemo(() => {
    const groups = new Map<string, AgentEvent[]>()
    for (const e of events) {
      const key = `${e.agent}:${e.run_id ?? 'none'}`
      groups.set(key, [...(groups.get(key) ?? []), e])
    }
    return [...groups.values()].map((list) => list.slice().reverse())
  }, [events])

  return (
    <>
      <button className="activity-btn" onClick={() => onOpenChange(true)} aria-haspopup="dialog" title="Agent activity">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 12h4l3-8 4 16 3-8h4" />
        </svg>
        <span>Agent activity</span>
      </button>
      {open && (
        <div className="drawer-backdrop" onClick={() => onOpenChange(false)}>
          <aside className="drawer" role="dialog" aria-label="Agent activity" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-head">
              <div>
                <h2>Agent activity</h2>
                <p className="muted small">What the AI agents did for {pet.name}, step by step. Times are {pet.name}'s home time, yours in gray.</p>
              </div>
              <button className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="drawer-body">
              {error && <p className="error">{error}</p>}
              {!error && runs.length === 0 && (
                <p className="empty">No agent activity yet. Try “Set up with AI” on the Schedule tab.</p>
              )}
              {runs.map((list) => {
                const first = list[0]
                const info = agentInfo(first.agent)
                return (
                  <section key={`${first.agent}-${first.run_id}`} className="run" style={{ ['--agent' as string]: info.color, ['--agent-soft' as string]: info.soft }}>
                    <div className="run-head">
                      <AgentBadge agent={first.agent} size={30} />
                      <div>
                        <strong>{info.name}</strong>
                        <span className="muted small"> · started <When t={stampFor(first.created_at, pet, 'owner')} /></span>
                      </div>
                    </div>
                    <ol className="steps">
                      {list.map((e) => (
                        <li key={e.id} className={`step step-${e.kind}`}>
                          <span className="step-dot" aria-hidden />
                          <div>
                            <p className="step-meta">
                              <b>{KIND_LABEL[e.kind] ?? e.kind}</b> · <When t={stampFor(e.created_at, pet, 'owner', false)} />
                            </p>
                            <p className="step-msg">{e.message}</p>
                            {e.kind === 'model_call' && e.detail && <TokenChips d={e.detail} />}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )
              })}
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

function TokenChips({ d }: { d: Record<string, unknown> }) {
  const n = (k: string) => Number(d[k] ?? 0).toLocaleString()
  return (
    <p className="token-chips">
      <span>in {n('input_tokens')}</span>
      <span>cached {n('cached_tokens')}</span>
      <span>out {n('output_tokens')}</span>
      <span>{(Number(d.duration_ms ?? 0) / 1000).toFixed(1)}s</span>
    </p>
  )
}
