import { useEffect, useState, type FormEvent } from 'react'
import {
  api,
  repeatLabel,
  TASK_TYPES,
  WEEKDAYS,
  type AppointmentDraft,
  type Pet,
  type QuirkDraft,
  type SetupFlag,
  type SetupItem,
  type SetupRun,
  type Task,
  type TaskDraft,
} from './api'
import { AgentBadge, agentInfo } from './agents'
import { WallTime } from './Schedule'
import { todayIn } from './time'
import { TypeTag } from './TypeTag'
import { Field, Group, Segmented } from './ui'

const AGENT = 'setup_agent'

function sampleInstructions(pet: Pet): string {
  const s = pet.species.toLowerCase()
  const potty = s.includes('cat')
    ? 'scoop the litter every night pls'
    : s.includes('dog') || s.includes('puppy')
      ? 'take her out for a quick pee before bed'
      : 'change the litter tray every other day'
  return (
    `ok so ${pet.name} stuff 🙏 feed her a bit in the morning and again in the evening. ` +
    `pill goes with dinner now not breakfast. vet on thursday at 3 for her checkup, bring the carrier. ` +
    `she hides when it thunders so just leave her be, dont pull her out. ${potty}. ` +
    `oh and she threw up a little blood yesterday?? probably nothing`
  )
}

export function SetupAgent({ pet, onOpenActivity, onChanged }: { pet: Pet; onOpenActivity: () => void; onChanged: () => void }) {
  const [run, setRun] = useState<SetupRun | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const info = agentInfo(AGENT)

  // Pick up where the owner left off (e.g. after a reload).
  useEffect(() => {
    api.latestSetup(pet.id).then(
      (r) => {
        setRun(r)
        setLoaded(true)
      },
      () => setLoaded(true),
    )
  }, [pet.id])

  const act = async (fn: () => Promise<SetupRun>) => {
    setBusy(true)
    setError(null)
    try {
      setRun(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="agent-panel" style={{ ['--agent' as string]: info.color, ['--agent-soft' as string]: info.soft }}>
      <header className="agent-head">
        <AgentBadge agent={AGENT} size={44} />
        <div>
          <h2>Set up with AI</h2>
          <p className="muted small">
            Paste your instructions the way you'd text a friend. The setup agent turns them into tasks, appointments and
            quirks for you to check. <b>Nothing is saved until you approve it.</b>
          </p>
        </div>
        <button className="link-btn" onClick={onOpenActivity}>
          Activity ›
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {busy ? (
        <Thinking pet={pet} onOpenActivity={onOpenActivity} />
      ) : !loaded ? null : !run || run.status === 'done' || run.status === 'error' ? (
        <>
          {run?.status === 'done' && <DoneNote run={run} onClear={() => setRun(null)} />}
          {run?.status === 'error' && (
            <div className="agent-error">
              <p>
                <b>The setup agent couldn't finish.</b> {run.error}
              </p>
              <button className="btn primary small" onClick={() => act(() => api.startSetup(pet.id, run.instructions))}>
                Try again
              </button>
            </div>
          )}
          {run?.status !== 'done' && (
            <Compose
              pet={pet}
              initial={run?.instructions ?? ''}
              onSubmit={(text) => act(() => api.startSetup(pet.id, text))}
            />
          )}
        </>
      ) : (
        <>
          <Flags flags={run.flags} />
          {run.status === 'needs_answers' && (
            <Questions run={run} onSubmit={(answers) => act(() => api.answerSetup(run.id, answers))} />
          )}
          {run.status === 'proposal' && (
            <Proposal
              run={run}
              pet={pet}
              onRun={(r) => {
                setRun(r)
                onChanged()
              }}
            />
          )}
          {run.status === 'thinking' && <Thinking pet={pet} onOpenActivity={onOpenActivity} />}
          <button className="btn ghost small start-over" onClick={() => setRun(null)}>
            Start over
          </button>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

function Compose({ pet, initial, onSubmit }: { pet: Pet; initial: string; onSubmit: (t: string) => void }) {
  const [text, setText] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim().length >= 3) onSubmit(text.trim())
  }
  return (
    <form className="compose" onSubmit={submit}>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        placeholder={`e.g. “feed ${pet.name} a scoop at 7 and 6, pill with dinner, vet on thursday at 3, she hides when it thunders”`}
        aria-label="Your instructions"
      />
      <div className="form-actions">
        <button className="btn primary" disabled={text.trim().length < 3}>
          ✨ Read my instructions
        </button>
        <button type="button" className="btn soft" onClick={() => setText(sampleInstructions(pet))}>
          Try a sample
        </button>
      </div>
    </form>
  )
}

function Thinking({ pet, onOpenActivity }: { pet: Pet; onOpenActivity: () => void }) {
  return (
    <div className="thinking" role="status">
      <span className="dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <p>
        Reading your instructions with {pet.name}'s profile and schedule…{' '}
        <button className="link-btn" onClick={onOpenActivity}>
          Watch it work
        </button>
      </p>
    </div>
  )
}

function DoneNote({ run, onClear }: { run: SetupRun; onClear: () => void }) {
  const approved = run.items.filter((i) => i.state === 'approved').length
  return (
    <div className="agent-done">
      <p>
        <b>All done.</b>{' '}
        {run.items.length
          ? `${approved} of ${run.items.length} item${run.items.length !== 1 ? 's' : ''} saved.`
          : 'Nothing new to add.'}{' '}
        {run.summary}
      </p>
      <Flags flags={run.flags} />
      <button className="btn soft small" onClick={onClear}>
        Set up something else
      </button>
    </div>
  )
}

function Flags({ flags }: { flags: SetupFlag[] }) {
  if (!flags.length) return null
  return (
    <div className="agent-flags">
      {flags.map((f) => (
        <div key={f.id} className={`alert ${f.severity === 'emergency' ? 'alert-urgent' : 'alert-warning'}`} role="alert">
          <span className="alert-icon" aria-hidden>
            ⚠️
          </span>
          <div>
            <p>
              <b>{f.severity === 'emergency' ? 'Possible emergency.' : 'Health concern.'}</b> {f.message}
            </p>
            {f.advice && <p className="small">{f.advice}</p>}
            <p className="small muted">
              Not added as a task.{f.from === 'safety_check' && ' Spotted by the built-in safety check.'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function Questions({ run, onSubmit }: { run: SetupRun; onSubmit: (a: Record<string, string>) => void }) {
  const open = run.qa.filter((q) => !q.answer)
  const done = run.qa.filter((q) => q.answer)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const ready = open.every((q) => (answers[q.id] ?? '').trim())
  return (
    <form
      className="questions"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSubmit(answers)
      }}
    >
      {run.summary && <p className="agent-says">{run.summary}</p>}
      <p className="muted small">A few things were too vague to guess. Quick answers are fine.</p>
      {open.map((q, i) => (
        <label key={q.id} className="question">
          <span className="q-about">“{q.about}”</span>
          <span className="q-text">{q.question}</span>
          <input
            autoFocus={i === 0}
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            maxLength={500}
          />
        </label>
      ))}
      <div className="form-actions">
        <button className="btn primary" disabled={!ready}>
          Send answers
        </button>
      </div>
      {done.length > 0 && (
        <details className="earlier">
          <summary>Earlier answers ({done.length})</summary>
          <ul>
            {done.map((q) => (
              <li key={q.id}>
                {q.question} <b>{q.answer}</b>
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// The proposal: approve / edit / remove each item
// ---------------------------------------------------------------------------

function Proposal({ run, pet, onRun }: { run: SetupRun; pet: Pet; onRun: (r: SetupRun) => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [bulkError, setBulkError] = useState<string | null>(null)
  useEffect(() => {
    api.tasks(pet.id).then(setTasks, () => {})
  }, [pet.id, run.items])

  const pending = run.items.filter((i) => i.state === 'pending')
  const approveAll = async () => {
    setBulkError(null)
    let latest = run
    const failed: string[] = []
    for (const item of pending) {
      try {
        latest = await api.approveSetupItem(run.id, item.id)
      } catch (e) {
        failed.push(`${itemLabel(item)}: ${(e as Error).message}`)
      }
    }
    onRun(latest)
    if (failed.length) setBulkError(failed.join(' · '))
  }

  const groups: { kind: SetupItem['kind']; title: string }[] = [
    { kind: 'task', title: 'Schedule tasks' },
    { kind: 'appointment', title: 'Appointments' },
    { kind: 'quirk', title: 'Quirks for the profile' },
  ]

  return (
    <div className="proposal">
      {run.summary && <p className="agent-says">{run.summary}</p>}
      {groups.map((g) => {
        const list = run.items.filter((i) => i.kind === g.kind)
        if (!list.length) return null
        return (
          <section key={g.kind}>
            <h3 className="proposal-title">{g.title}</h3>
            <ul className="proposal-list">
              {list.map((item) => (
                <ProposalItem key={item.id} item={item} run={run} pet={pet} tasks={tasks} onRun={onRun} />
              ))}
            </ul>
          </section>
        )
      })}
      {pending.length > 1 && (
        <div className="form-actions">
          <button className="btn primary" onClick={approveAll}>
            Approve all {pending.length}
          </button>
        </div>
      )}
      {bulkError && <p className="error">{bulkError}</p>}
    </div>
  )
}

function itemLabel(item: SetupItem): string {
  return item.kind === 'quirk' ? 'Quirk' : item.data.title
}

function ProposalItem({
  item,
  run,
  pet,
  tasks,
  onRun,
}: {
  item: SetupItem
  run: SetupRun
  pet: Pet
  tasks: Task[]
  onRun: (r: SetupRun) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.data)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const approve = async (data?: object) => {
    setBusy(true)
    setError(null)
    try {
      onRun(await api.approveSetupItem(run.id, item.id, data))
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      onRun(await api.removeSetupItem(run.id, item.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const needsWho = item.kind === 'appointment' && !item.data.taken_by

  return (
    <li className={`proposal-item state-${item.state}`}>
      {editing ? (
        <ItemEditor item={{ ...item, data: draft } as SetupItem} pet={pet} tasks={tasks} onChange={(d) => setDraft(d as typeof draft)} />
      ) : (
        <ItemView item={item} pet={pet} />
      )}

      {item.source_text && !editing && <p className="source">From your note: “{item.source_text}”</p>}
      {item.state === 'pending' && item.warnings.map((w) => (
        <p key={w} className="item-warning">
          ⚠️ {w}
        </p>
      ))}
      {error && <p className="error">{error}</p>}

      {item.state === 'pending' && !editing && needsWho && (
        <Group label="Who's taking them?">
          <Segmented
            value={null}
            onChange={(v) => approve({ taken_by: v })}
            options={[
              { value: 'caretaker', label: `${pet.caretaker_name || 'Caretaker'} (approve)` },
              { value: 'owner', label: 'Me (approve)' },
            ]}
          />
        </Group>
      )}

      {item.state === 'pending' ? (
        <div className="item-actions">
          {editing ? (
            <>
              <button className="btn primary small" disabled={busy} onClick={() => approve(draft)}>
                Save &amp; approve
              </button>
              <button
                className="btn soft small"
                onClick={() => {
                  setDraft(item.data)
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {!needsWho && (
                <button className="btn primary small" disabled={busy} onClick={() => approve()}>
                  ✓ Approve
                </button>
              )}
              <button className="btn soft small" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="btn soft small" disabled={busy} onClick={remove}>
                Remove
              </button>
            </>
          )}
        </div>
      ) : (
        <p className={`item-state ${item.state}`}>
          {item.state === 'approved' ? `✓ Approved${item.edited ? ' with edits' : ''} and saved` : 'Removed, not saved'}
        </p>
      )}
    </li>
  )
}

function ItemView({ item, pet }: { item: SetupItem; pet: Pet }) {
  const [today] = useState(() => todayIn(pet.home_timezone))
  if (item.kind === 'task') {
    const t = item.data
    return (
      <div className="item-body">
        <span className="item-time">
          <WallTime day={today} hhmm={t.time} pet={pet} role="owner" />
        </span>
        <div>
          <div className="task-head">
            <strong>{t.title}</strong>
            <TypeTag type={t.type} />
            <span className="muted small">{repeatLabel(t)}</span>
          </div>
          {t.dose && <p className="dose">Dose: {t.dose}</p>}
          {t.notes && <p className="notes small">{t.notes}</p>}
          {t.replaces && (
            <p className="replaces small">
              Replaces “{t.replaces.title}” at {t.replaces.time}
              {t.replaces.dose ? ` (${t.replaces.dose})` : ''}
            </p>
          )}
        </div>
      </div>
    )
  }
  if (item.kind === 'appointment') {
    const a = item.data
    return (
      <div className="item-body">
        <span className="item-time">
          <WallTime day={a.date} hhmm={a.time} pet={pet} role="owner" />
        </span>
        <div>
          <div className="task-head">
            <strong>{a.title}</strong>
            <span className={`type-tag kind-${a.kind}`}>{a.kind[0].toUpperCase() + a.kind.slice(1)}</span>
          </div>
          <p className="small">{new Date(`${a.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
          {(a.place_name || a.address) && <p className="small muted">{[a.place_name, a.address].filter(Boolean).join(', ')}</p>}
          {a.bring && <p className="small">Bring: {a.bring}</p>}
          <p className="small muted">{a.taken_by ? `Taken by: ${a.taken_by === 'owner' ? 'you' : pet.caretaker_name || 'caretaker'}` : 'Who’s taking them? Choose below.'}</p>
        </div>
      </div>
    )
  }
  return <p className="item-quirk">“{item.data.text}”</p>
}

function ItemEditor({ item, pet, tasks, onChange }: { item: SetupItem; pet: Pet; tasks: Task[]; onChange: (d: object) => void }) {
  if (item.kind === 'quirk') {
    const q: QuirkDraft = item.data
    return (
      <Field label="Quirk">
        <textarea rows={2} value={q.text} onChange={(e) => onChange({ ...q, text: e.target.value })} />
      </Field>
    )
  }
  if (item.kind === 'appointment') {
    const a: AppointmentDraft = item.data
    const set = (k: keyof AppointmentDraft, v: string | null) => onChange({ ...a, [k]: v })
    return (
      <div className="grid-2">
        <Field label="Title">
          <input value={a.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Type">
          <select value={a.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="vet">Vet</option>
            <option value="groomer">Groomer</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label={`Date (${pet.name}'s home time)`}>
          <input type="date" value={a.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Time">
          <input type="time" value={a.time} onChange={(e) => set('time', e.target.value)} />
        </Field>
        <Field label="Place">
          <input value={a.place_name} onChange={(e) => set('place_name', e.target.value)} />
        </Field>
        <Field label="Address">
          <input value={a.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Group label="Who's taking them?">
          <Segmented
            value={a.taken_by}
            onChange={(v) => set('taken_by', v)}
            options={[
              { value: 'caretaker', label: pet.caretaker_name || 'Caretaker' },
              { value: 'owner', label: 'Me' },
            ]}
          />
        </Group>
        <Field label="What to bring">
          <input value={a.bring} onChange={(e) => set('bring', e.target.value)} />
        </Field>
      </div>
    )
  }
  const t: TaskDraft = item.data
  const set = (k: keyof TaskDraft, v: unknown) => onChange({ ...t, [k]: v })
  return (
    <div className="grid-3">
      <Field label="Title">
        <input value={t.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Type">
        <select value={t.type} onChange={(e) => set('type', e.target.value)}>
          {TASK_TYPES.map((x) => (
            <option key={x.value} value={x.value}>
              {x.icon} {x.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`Time (${pet.name}'s home time)`}>
        <input type="time" value={t.time} onChange={(e) => set('time', e.target.value)} />
      </Field>
      <Field label="Repeat">
        <select
          value={t.repeat}
          onChange={(e) =>
            onChange({
              ...t,
              repeat: e.target.value,
              repeat_on: e.target.value === 'weekly' ? 'mon' : e.target.value === 'once' ? todayIn(pet.home_timezone) : null,
            })
          }
        >
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekends">Weekends</option>
          <option value="weekly">Once a week</option>
          <option value="once">Just once</option>
        </select>
      </Field>
      {t.repeat === 'weekly' && (
        <Field label="On">
          <select value={t.repeat_on ?? 'mon'} onChange={(e) => set('repeat_on', e.target.value)}>
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {d[0].toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {t.repeat === 'once' && (
        <Field label="Date">
          <input type="date" value={t.repeat_on ?? ''} onChange={(e) => set('repeat_on', e.target.value)} />
        </Field>
      )}
      {t.type === 'meds' && (
        <Field label="Dose">
          <input value={t.dose ?? ''} onChange={(e) => set('dose', e.target.value)} />
        </Field>
      )}
      <Field label="Replaces an existing task?">
        <select
          value={t.replaces_task_id ?? ''}
          onChange={(e) => onChange({ ...t, replaces_task_id: e.target.value ? Number(e.target.value) : null, replaces: undefined })}
        >
          <option value="">No, add it as new</option>
          {tasks.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title} ({x.time}
              {x.dose ? `, ${x.dose}` : ''})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <input value={t.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </div>
  )
}
