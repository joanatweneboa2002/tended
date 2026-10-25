import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addDays,
  api,
  formatDate,
  repeatLabel,
  TASK_TYPES,
  WEEKDAYS,
  type Checkin,
  type CheckinStatus,
  type DayTask,
  type Pet,
  type Role,
  type Task,
  type TaskInput,
} from './api'
import { Field, Segmented } from './ui'
import { stamp, todayIn, viewerTz, wallForViewer } from './time'
import { SetupAgent } from './SetupAgent'
import { IconCircle, TASK_LOOK } from './Icons'
import { ProgressRing } from './ProgressRing'
import { TypeTag } from './TypeTag'

/** A home-time HH:MM shown in the viewer's time, with home time underneath if different. */
export function WallTime({ day, hhmm, pet, role }: { day: string; hhmm: string; pet: Pet; role: Role }) {
  const t = wallForViewer(day, hhmm, pet, role)
  return (
    <span className="wall-time">
      {t.main}
      {t.home && <small>{t.home} {pet.name}'s time</small>}
    </span>
  )
}

export function Schedule({ pet, role, onOpenActivity }: { pet: Pet; role: Role; onOpenActivity: () => void }) {
  const [section, setSection] = useState<'today' | 'edit' | 'history' | 'ai'>('today')
  if (role === 'caretaker') return <DayTasks pet={pet} role={role} canCheckIn />
  return (
    <div className="stack">
      <div className="schedule-bar">
        <Segmented
          value={section === 'ai' ? null : section}
          onChange={setSection}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'edit', label: 'Edit schedule' },
            { value: 'history', label: 'Check-in history' },
          ]}
        />
        <button className={`btn ai-btn ${section === 'ai' ? 'active' : ''}`} onClick={() => setSection('ai')}>
          ✨ Set up with AI
        </button>
      </div>
      {section === 'ai' && <SetupAgent pet={pet} onOpenActivity={onOpenActivity} onChanged={() => {}} />}
      {section === 'today' && <DayTasks pet={pet} role={role} canCheckIn={false} />}
      {section === 'edit' && <ScheduleEditor pet={pet} />}
      {section === 'history' && <CheckinHistory pet={pet} role={role} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A day's tasks (caretaker checks in; owner sees status)
// ---------------------------------------------------------------------------

function DayTasks({ pet, role, canCheckIn }: { pet: Pet; role: Role; canCheckIn: boolean }) {
  const [today] = useState(() => todayIn(pet.home_timezone))
  const [date, setDate] = useState(today)
  const [tasks, setTasks] = useState<DayTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.day(pet.id, date).then(
      (d) => {
        setTasks(d.tasks)
        setError(null)
      },
      (e) => setError(e.message),
    )
  }, [pet.id, date])
  useEffect(load, [load])

  const doneCount = tasks?.filter((t) => t.checkins.some((c) => c.status === 'done')).length ?? 0

  return (
    <div className="stack">
      <section className="card day-head">
        {tasks && tasks.length > 0 && <ProgressRing done={doneCount} total={tasks.length} size={84} />}
        <div className="day-head-text">
          <h2>{date === today ? 'Today' : formatDate(date, { weekday: 'long' })}</h2>
          <p className="muted small">
            {formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}
            {role === 'owner' && ` · ${pet.name}'s day, shown in your time`}
          </p>
        </div>
        <div className="day-nav">
          <button className="btn ghost small" onClick={() => setDate(addDays(date, -1))}>‹ Earlier</button>
          <button className="btn ghost small" onClick={() => setDate(today)} disabled={date === today}>Today</button>
          <button className="btn ghost small" onClick={() => setDate(addDays(date, 1))} disabled={date >= today}>Later ›</button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {tasks && tasks.length === 0 && <p className="empty card">Nothing scheduled for {pet.name} on this day.</p>}

      <ol className="task-list">
        {tasks?.map((t) => (
          <TaskCard key={t.id} task={t} date={date} pet={pet} role={role} canCheckIn={canCheckIn} onSaved={load} />
        ))}
      </ol>
    </div>
  )
}

function TaskCard({
  task,
  date,
  pet,
  role,
  canCheckIn,
  onSaved,
}: {
  task: DayTask
  date: string
  pet: Pet
  role: Role
  canCheckIn: boolean
  onSaved: () => void
}) {
  const [mode, setMode] = useState<CheckinStatus | null>(null)
  const [bounce, setBounce] = useState(false)
  const look = TASK_LOOK[task.type]
  const isMeds = task.type === 'meds'
  const given = isMeds && task.checkins.some((c) => c.status === 'done')
  const done = task.checkins.some((c) => c.status === 'done')
  const missed = !done && task.checkins.some((c) => c.status === 'could_not')

  return (
    <li
      className={`task card tint-${look.tone} ${done ? 'is-done' : ''} ${missed ? 'is-missed' : ''} ${isMeds ? 'is-meds' : ''} ${bounce ? 'bounce' : ''}`}
      onAnimationEnd={() => setBounce(false)}
    >
      <div className="task-time">
        <span className="task-icon">
          <IconCircle name={done ? 'check' : look.icon} tone={done ? 'mint' : look.tone} size={44} />
        </span>
        <WallTime day={date} hhmm={task.time} pet={pet} role={role} />
      </div>
      <div className="task-main">
        <div className="task-head">
          <h3>{task.title}</h3>
          <TypeTag type={task.type} />
        </div>
        {task.dose && <p className="dose">Dose: {task.dose}</p>}
        {task.notes && <p className="notes">{task.notes}</p>}

        {task.checkins.length > 0 && (
          <ul className="checkin-list">
            {task.checkins.map((c) => (
              <CheckinLine key={c.id} c={c} tz={viewerTz(pet, role)} />
            ))}
          </ul>
        )}

        {!canCheckIn ? (
          task.checkins.length === 0 && <p className="muted small pending-note">Not checked in yet.</p>
        ) : given ? (
          <p className="locked">🔒 Dose given. A second dose for this time slot is blocked.</p>
        ) : mode ? (
          <CheckinForm
            task={task}
            date={date}
            status={mode}
            onCancel={() => setMode(null)}
            onSaved={(status) => {
              setMode(null)
              if (status === 'done') setBounce(true)
              onSaved()
            }}
            onBlocked={onSaved}
          />
        ) : (
          <div className="task-actions">
            <button className="btn primary" onClick={() => setMode('done')}>
              {isMeds ? 'Mark dose given' : done ? 'Log again' : 'Done'}
            </button>
            <button className="btn soft" onClick={() => setMode('could_not')}>
              Couldn't do it
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

export function CheckinLine({ c, tz, showTask = false }: { c: Checkin; tz: string; showTask?: boolean }) {
  return (
    <li className={`checkin ${c.status}`}>
      <span className="checkin-mark" aria-hidden>
        {c.status === 'done' ? '✓' : '!'}
      </span>
      <div className="checkin-body">
        <p>
          <strong>
            {showTask && c.task_title ? `${c.task_title}: ` : ''}
            {c.status === 'done' ? (c.task_type === 'meds' ? 'Dose given' : 'Done') : "Couldn't do it"}
          </strong>
          <span className="muted">
            {' '}
            · {stamp(c.created_at, tz)}
            {c.caretaker_name && ` · ${c.caretaker_name}`}
          </span>
        </p>
        {c.reason && <p className="reason">Reason: {c.reason}</p>}
        {c.note && <p>{c.note}</p>}
      </div>
      {c.photo_url && (
        <a href={c.photo_url} target="_blank" rel="noreferrer">
          <img className="checkin-photo" src={c.photo_url} alt="Check-in photo" />
        </a>
      )}
    </li>
  )
}

function CheckinForm({
  task,
  date,
  status,
  onCancel,
  onSaved,
  onBlocked,
}: {
  task: DayTask
  date: string
  status: CheckinStatus
  onCancel: () => void
  onSaved: (status: CheckinStatus) => void
  onBlocked: () => void
}) {
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (status === 'could_not' && !reason.trim()) {
      setError('Please say why.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.checkIn({ task_id: task.id, slot_date: date, status, reason, note, photo })
      onSaved(status)
    } catch (err) {
      setError((err as Error).message)
      if ((err as { status?: number }).status === 409) onBlocked()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={`checkin-form ${status}`} onSubmit={submit}>
      {status === 'could_not' ? (
        <Field label="Why couldn't you do it? *">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
        </Field>
      ) : (
        <Field label="How did it go? (optional)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={task.type === 'feed' ? 'e.g. ate it all / left half' : ''}
            autoFocus
          />
        </Field>
      )}
      <PhotoPicker label="Photo (optional)" file={photo} onChange={setPhoto} />
      {error && <p className="error">{error}</p>}
      <div className="task-actions">
        <button className={`btn ${status === 'done' ? 'primary' : 'warn'}`} disabled={saving}>
          {saving
            ? 'Saving…'
            : status === 'done'
              ? task.type === 'meds'
                ? 'Confirm dose given'
                : 'Save check-in'
              : "Save: couldn't do it"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** File input with a thumbnail preview. */
export function PhotoPicker({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )
  const pick = (f: File | null) => {
    onChange(f)
    setPreview(f ? URL.createObjectURL(f) : null)
  }
  return (
    <label className="field photo-field">
      <span>{label}</span>
      <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      {preview && file && <img className="checkin-photo" src={preview} alt="Preview" />}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Owner: edit the schedule
// ---------------------------------------------------------------------------

const emptyTask = (): TaskInput => ({
  title: '',
  type: 'feed',
  time: '08:00',
  repeat: 'daily',
  repeat_on: null,
  notes: '',
  dose: null,
})

function ScheduleEditor({ pet }: { pet: Pet }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [today] = useState(() => todayIn(pet.home_timezone))

  const load = useCallback(() => {
    api.tasks(pet.id).then(setTasks, (e) => setError(e.message))
  }, [pet.id])
  useEffect(load, [load])

  const remove = async (t: Task) => {
    if (!confirm(`Remove "${t.title}" from the schedule? Past check-ins are kept.`)) return
    await api.deleteTask(t.id)
    load()
  }
  const done = () => {
    setEditing(null)
    load()
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Daily schedule</h2>
        {editing === null && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            + Add task
          </button>
        )}
      </div>
      <p className="muted small">Shown in your time. Set times in {pet.name}'s home time when you edit.</p>
      {error && <p className="error">{error}</p>}

      {editing === 'new' && <TaskForm pet={pet} task={null} onDone={done} />}

      <ul className="schedule">
        {tasks.map((t) =>
          editing !== null && editing !== 'new' && editing.id === t.id ? (
            <li key={t.id}>
              <TaskForm pet={pet} task={t} onDone={done} />
            </li>
          ) : (
            <li key={t.id} className={`schedule-row ${t.type === 'meds' ? 'is-meds' : ''}`}>
              <span className="task-time">
                <WallTime day={today} hhmm={t.time} pet={pet} role="owner" />
              </span>
              <div className="schedule-main">
                <div className="task-head">
                  <strong>{t.title}</strong>
                  <TypeTag type={t.type} />
                  <span className="muted small">{repeatLabel(t)}</span>
                </div>
                {t.dose && <p className="dose">Dose: {t.dose}</p>}
                {t.notes && <p className="notes">{t.notes}</p>}
              </div>
              <div className="row-actions">
                <button className="btn ghost small" onClick={() => setEditing(t)}>
                  Edit
                </button>
                <button className="btn ghost small" onClick={() => remove(t)}>
                  Remove
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      {tasks.length === 0 && editing === null && <p className="empty">No tasks yet.</p>}
    </div>
  )
}

function TaskForm({ pet, task, onDone }: { pet: Pet; task: Task | null; onDone: () => void }) {
  const [form, setForm] = useState<TaskInput>(() => (task ? { ...task } : emptyTask()))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const setRepeat = (repeat: TaskInput['repeat']) =>
    setForm((f) => ({
      ...f,
      repeat,
      repeat_on: repeat === 'weekly' ? 'mon' : repeat === 'once' ? todayIn(pet.home_timezone) : null,
    }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const body: TaskInput = {
      title: form.title,
      type: form.type,
      time: form.time,
      repeat: form.repeat,
      repeat_on: form.repeat_on,
      notes: form.notes,
      dose: form.type === 'meds' ? form.dose : null,
    }
    try {
      if (task) await api.updateTask(task.id, body)
      else await api.createTask(pet.id, body)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="task-form" onSubmit={submit}>
      <div className="grid-3">
        <Field label="Title *">
          <input required value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </Field>
        <Field label="Type">
          <select value={form.type} onChange={(e) => set('type', e.target.value as TaskInput['type'])}>
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Time * (${pet.name}'s home time)`}>
          <input type="time" required value={form.time} onChange={(e) => set('time', e.target.value)} />
        </Field>
        <Field label="Repeat">
          <select value={form.repeat} onChange={(e) => setRepeat(e.target.value as TaskInput['repeat'])}>
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekends">Weekends</option>
            <option value="weekly">Once a week</option>
            <option value="once">Just once</option>
          </select>
        </Field>
        {form.repeat === 'weekly' && (
          <Field label="On">
            <select value={form.repeat_on ?? 'mon'} onChange={(e) => set('repeat_on', e.target.value)}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {form.repeat === 'once' && (
          <Field label="Date">
            <input type="date" required value={form.repeat_on ?? ''} onChange={(e) => set('repeat_on', e.target.value)} />
          </Field>
        )}
        {form.type === 'meds' && (
          <Field label="Dose *">
            <input
              required
              value={form.dose ?? ''}
              onChange={(e) => set('dose', e.target.value)}
              placeholder="e.g. 2.5 mg, 1 tablet"
            />
          </Field>
        )}
      </div>
      <Field label="Notes">
        <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="btn primary">{task ? 'Save task' : 'Add task'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Owner: check-in history
// ---------------------------------------------------------------------------

function CheckinHistory({ pet, role }: { pet: Pet; role: Role }) {
  const [checkins, setCheckins] = useState<Checkin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [since] = useState(() => addDays(todayIn(pet.home_timezone), -7))

  useEffect(() => {
    api.checkins(pet.id, since).then(setCheckins, (e) => setError(e.message))
  }, [pet.id, since])

  const byDay = useMemo(() => {
    const groups = new Map<string, Checkin[]>()
    for (const c of checkins ?? []) groups.set(c.slot_date, [...(groups.get(c.slot_date) ?? []), c])
    return [...groups.entries()]
  }, [checkins])

  return (
    <div className="card">
      <h2>Check-ins: last 7 days</h2>
      {error && <p className="error">{error}</p>}
      {checkins && checkins.length === 0 && <p className="empty">No check-ins yet.</p>}
      {byDay.map(([day, list]) => (
        <section key={day} className="history-day">
          <h3>{formatDate(day, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
          <ul className="checkin-list">
            {list
              .slice()
              .sort((a, b) => a.slot_time.localeCompare(b.slot_time))
              .map((c) => (
                <CheckinLine key={c.id} c={c} tz={viewerTz(pet, role)} showTask />
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
