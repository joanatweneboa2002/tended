import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, type HelperRun, type HelperSource, type Pet } from './api'
import { AgentBadge, agentInfo } from './agents'

const AGENT = 'caretaker_helper'

const SAMPLES = [
  { label: 'Normal', text: 'can she have a bit of chicken?' },
  { label: "Can't answer", text: 'where are her spare treats kept?' },
  { label: 'Emergency', text: 'she ate a lily leaf' },
]

const firstName = (name: string) => (name && name !== 'Owner' ? name.split(' ')[0] : 'the owner')
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/** "Ask Tended" pill button that opens the helper sheet. */
export function AskTendedButton({ pet, variant = 'pill' }: { pet: Pet; variant?: 'pill' | 'small' }) {
  const [open, setOpen] = useState(false)
  const info = agentInfo(AGENT)
  return (
    <>
      <button
        className={`ask-btn ${variant}`}
        style={{ ['--agent' as string]: info.color, ['--agent-soft' as string]: info.soft }}
        onClick={() => setOpen(true)}
      >
        <AgentBadge agent={AGENT} size={variant === 'small' ? 24 : 30} />
        <span>Ask Tended</span>
      </button>
      {open && createPortal(<AskSheet pet={pet} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function AskSheet({ pet, onClose }: { pet: Pet; onClose: () => void }) {
  const [history, setHistory] = useState<HelperRun[]>([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const info = agentInfo(AGENT)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // While waiting, show the bottom; when an answer arrives, show its start
  // (so the top of a long emergency card is never scrolled out of view).
  useEffect(() => {
    if (asking) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    else endRef.current?.parentElement?.querySelector('.exchange:last-of-type')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [history, asking])

  const ask = async (text: string) => {
    const q = text.trim()
    if (q.length < 2 || asking) return
    setAsking(q)
    setError(null)
    setQuestion('')
    try {
      const run = await api.askHelper(pet.id, q)
      setHistory((h) => [...h, run])
    } catch (e) {
      setError((e as Error).message)
      setQuestion(q)
    } finally {
      setAsking(null)
    }
  }

  const update = (run: HelperRun) => setHistory((h) => h.map((r) => (r.id === run.id ? run : r)))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal ask-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Ask Tended"
        onClick={(e) => e.stopPropagation()}
        style={{ ['--agent' as string]: info.color, ['--agent-soft' as string]: info.soft }}
      >
        <header className="ask-head">
          <AgentBadge agent={AGENT} size={40} />
          <div>
            <h2>Ask Tended</h2>
            <p className="muted small">
              Quick answers about {pet.name}, only from the profile, emergency card, recent log and a vet reference.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="ask-body">
          {history.length === 0 && !asking && (
            <div className="ask-empty">
              <p className="muted small">Try one:</p>
              <div className="sample-qs">
                {SAMPLES.map((s) => (
                  <button key={s.text} className="sample-q" onClick={() => ask(s.text)}>
                    <span className="sample-tag">{s.label}</span>“{s.text}”
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.map((run) => (
            <Exchange key={run.id} run={run} onUpdate={update} />
          ))}
          {asking && (
            <>
              <p className="ask-q">{asking}</p>
              <div className="thinking small-thinking" role="status">
                <span className="dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <p>Checking {pet.name}'s profile, log and the vet reference…</p>
              </div>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <div ref={endRef} />
        </div>

        <form
          className="ask-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            ask(question)
          }}
        >
          {history.length > 0 && (
            <div className="sample-qs compact">
              {SAMPLES.map((s) => (
                <button type="button" key={s.text} className="sample-q" disabled={!!asking} onClick={() => ask(s.text)}>
                  “{s.text}”
                </button>
              ))}
            </div>
          )}
          <div className="composer-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Ask about ${pet.name}…`}
              maxLength={500}
              aria-label="Your question"
              autoFocus
            />
            <button className="btn primary" disabled={question.trim().length < 2 || !!asking}>
              Ask
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Exchange({ run, onUpdate }: { run: HelperRun; onUpdate: (r: HelperRun) => void }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const owner = firstName(run.owner_name)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      onUpdate(await api.helperMessageOwner(run.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const sendButton = (label: string, cls = 'btn soft small') =>
    run.messaged_owner ? (
      <p className="sent-note">✓ Sent to {owner}. You'll see the reply in Messages.</p>
    ) : (
      <button className={cls} onClick={send} disabled={sending}>
        {sending ? 'Sending…' : label}
      </button>
    )

  return (
    <div className="exchange">
      <p className="ask-q">{run.question}</p>

      {run.status === 'emergency' && run.emergency ? (
        <section className="urgent" role="alert">
          <p className="urgent-title">🚨 This could be an emergency</p>
          <p className="urgent-reason">{run.emergency.reason}</p>
          <p className="urgent-do">Don't wait to see if it gets better. Call the vet now.</p>
          {run.emergency.vet_phone ? (
            <a className="call-vet" href={tel(run.emergency.vet_phone)}>
              <span>📞 Call {run.emergency.vet_name || 'the vet'}</span>
              <b>{run.emergency.vet_phone}</b>
            </a>
          ) : (
            <p className="urgent-missing">No vet phone on the emergency card. Call {owner} or your nearest emergency vet.</p>
          )}
          {run.emergency.vet_address && <p className="urgent-addr">{run.emergency.vet_address}</p>}
          <p className="urgent-limit">
            {run.emergency.spending_limit != null ? (
              <>
                {owner} approved emergency vet costs <b>up to ${run.emergency.spending_limit.toLocaleString()}</b>.
              </>
            ) : (
              <>No spending limit set. Call {owner} before agreeing to costs.</>
            )}
          </p>
          <div className="urgent-actions">
            {sendButton(`💬 Message ${owner} now`, 'btn urgent-msg')}
            {run.emergency.owner_phone && (
              <a className="btn soft small" href={tel(run.emergency.owner_phone)}>
                Call {owner}
              </a>
            )}
          </div>
          <Sources sources={run.emergency.reference} />
        </section>
      ) : run.status === 'not_sure' ? (
        <div className="ask-a not-sure">
          <p>{run.answer}</p>
          {run.error && <p className="muted small">{run.error}</p>}
          {sendButton(`Send this question to ${owner}`, 'btn primary small')}
        </div>
      ) : (
        <div className="ask-a">
          <p>{run.answer}</p>
          <Sources sources={run.sources} />
          {run.suggest_message_owner && sendButton(`Let ${owner} know`)}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

const KIND: Record<HelperSource['kind'], string> = {
  profile: '🐾 Profile',
  emergency_card: '🩺 Emergency card',
  log: '📋 Log',
  reference: '📚 Reference',
}

function Sources({ sources }: { sources: HelperSource[] }) {
  if (!sources.length) return null
  return (
    <div className="sources">
      <span className="sources-label">From:</span>
      {sources.map((s) => (
        <span key={s.id} className={`source-chip src-${s.kind}`} title={s.detail}>
          {KIND[s.kind]} · {s.label}
          {s.source && <em> ({s.source})</em>}
        </span>
      ))}
    </div>
  )
}
