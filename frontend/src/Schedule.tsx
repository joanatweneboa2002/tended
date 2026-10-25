import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addDays,
  api,
  formatDate,
  formatTime,
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
import { Field, Segmented, When } from './ui'
import { stampFor, todayIn, wallForViewer, wallToDate } from './time'
import { SetupAgent } from './SetupAgent'
import { PawDoodle } from './Doodles'
import { Icon, IconCircle, TASK_LOOK } from './Icons'
import { ProgressRing } from './ProgressRing'
import { TypeTag } from './TypeTag'

/** A home-time HH:MM, with the owner's own time underneath (owner view, when it differs). */
export function WallTime({ day, hhmm, pet, role }: { day: string; hhmm: string; pet: Pet; role: Role }) {
  const t = wallForViewer(day, hhmm, pet, role)
  return (
    <span className="wall-time">
      {t.main}
      {t.yours && <small>{t.yours} for you</small>}
    </span>
  )
}

export function Schedule({ pet, role, onOpenActivity, start = 'today' }: { pet: Pet; role: Role; onOpenActivity: () => void; start?: 'today' | 'ai' }) {
  const [section, setSection] = useState<'today' | 'edit' | 'history' | 'ai'>(start)
  if (role === 'caretaker') return <DayTasks pet={pet} role={role} />
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
      {section === 'today' && <DayTasks pet={pet} role={role} />}
      {section === 'edit' && <ScheduleEditor pet={pet} />}
      {section === 'history' && <CheckinHistory pet={pet} role={role} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A day's tasks (caretaker checks in; owner sees status)
// ---------------------------------------------------------------------------

function DayTasks({ pet, role }: { pet: Pet; role: Role }) {
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
            {role === 'owner' && ` · ${pet.name}'s home time, yours underneath`}
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
          <TaskCard key={t.id} task={t} date={date} pet={pet} role={role} onSaved={load} />
        ))}
      </ol>
    </div>
  )
}

const UNDO_MS = 120_000

/** Tick logic shared by the Schedule task cards and Home's timeline and Next up card:
 *  one tap ticks a task off (optionally with a photo), meds ask once to confirm,
 *  undo for 2 minutes. `onTicked` lets a parent keep the undo when this card goes away. */
export function useTaskTick(
  task: DayTask,
  date: string,
  role: Role,
  onSaved: () => void,
  onTicked?: (checkinId: number, title: string) => void,
) {
  const [confirmMeds, setConfirmMeds] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null) // waiting on the meds confirm
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<number | null>(null) // check-in id that can still be undone
  const [bounce, setBounce] = useState(false)
  const isMeds = task.type === 'meds'
  const done = task.checkins.some((c) => c.status === 'done')

  useEffect(() => {
    if (ticked === null) return
    const t = setTimeout(() => setTicked(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [ticked])

  const tick = async (withPhoto?: File) => {
    if (done || busy) return
    const file = withPhoto ?? photo
    if (isMeds && !confirmMeds) {
      setPhoto(file) // one extra tap for medication, so a stray tap can't record a dose
      setConfirmMeds(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const c = await api.checkIn({ task_id: task.id, slot_date: date, status: 'done', role, photo: file })
      setConfirmMeds(false)
      setPhoto(null)
      setTicked(c.id)
      setBounce(true)
      onTicked?.(c.id, task.title)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      if ((e as { status?: number }).status === 409) onSaved()
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (ticked === null) return
    try {
      await api.undoCheckin(ticked)
      setTicked(null)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setTicked(null)
    }
  }

  const cancelConfirm = () => {
    setConfirmMeds(false)
    setPhoto(null)
  }

  return { isMeds, done, confirmMeds, cancelConfirm, photo, busy, error, ticked, bounce, setBounce, tick, undo }
}

/** The round tick button (with a paw burst when it's ticked). */
export function TickButton({ t, title }: { t: ReturnType<typeof useTaskTick>; title: string }) {
  return (
    <button
      className={`tick ${t.done ? 'on' : ''} ${t.confirmMeds ? 'asking' : ''}`}
      role="checkbox"
      aria-checked={t.done}
      aria-label={t.done ? `${title}: done` : `Tick off ${title}`}
      onClick={() => t.tick()}
      disabled={t.done || t.busy}
    >
      <Icon name="check" size={22} />
      {t.bounce && (
        <span className="paw-burst" aria-hidden>
          <PawDoodle size={14} />
          <PawDoodle size={11} />
          <PawDoodle size={13} />
        </span>
      )}
    </button>
  )
}

/** Confirm row for meds + the undo link, shared by cards and rows. */
export function TickExtras({ t, task }: { t: ReturnType<typeof useTaskTick>; task: DayTask }) {
  return (
    <>
      {t.confirmMeds && !t.done && (
        <div className="confirm-meds" role="alertdialog" aria-label="Confirm dose">
          <p>
            Mark <b>{task.dose || task.title}</b> as given{t.photo ? ' (with your photo)' : ''}?
          </p>
          <button className="btn primary small" onClick={() => t.tick()} disabled={t.busy}>
            Yes, given
          </button>
          <button className="btn soft small" onClick={t.cancelConfirm}>
            Not yet
          </button>
        </div>
      )}
      {t.ticked !== null && (
        <p className="undo-row">
          Ticked off{' '}
          <button className="link-btn" onClick={t.undo}>
            Undo
          </button>
        </p>
      )}
      {t.error && <p className="error">{t.error}</p>}
    </>
  )
}

const TYPE_WORD: Record<string, string> = { feed: 'Food', walk: 'Walk', meds: 'Meds', potty: 'Potty', other: 'Care' }

/** One timeline row for Home: home time on the left (the owner's own time small
 *  underneath), a colored dot for the task type, the task, a big round tick. */
export function TodoRow({ task, date, pet, role, onSaved }: { task: DayTask; date: string; pet: Pet; role: Role; onSaved: () => void }) {
  if (role === 'owner') return <OwnerTodoRow task={task} date={date} pet={pet} />
  return <CaretakerTodoRow task={task} date={date} pet={pet} onSaved={onSaved} />
}

/** Owner: read only. What the caretaker did, or when it's due. */
function OwnerTodoRow({ task, date, pet }: { task: DayTask; date: string; pet: Pet }) {
  const when = wallForViewer(date, task.time, pet, 'owner')
  const done = task.checkins.some((c) => c.status === 'done')
  return (
    <li className={`tl-row tl-readonly type-${task.type} ${done ? 'is-done' : ''}`}>
      <p className="tl-time">
        {when.main}
        {when.yours && <small>{when.yours}</small>}
      </p>
      <span className="tl-dot" aria-hidden />
      <div className="tl-main">
        <p className="tl-title">{task.title}</p>
        <TaskStatus task={task} date={date} pet={pet} />
      </div>
    </li>
  )
}

function CaretakerTodoRow({ task, date, pet, onSaved }: { task: DayTask; date: string; pet: Pet; onSaved: () => void }) {
  const role: Role = 'caretaker'
  const t = useTaskTick(task, date, role, onSaved)
  const when = wallForViewer(date, task.time, pet, role)
  return (
    <li
      className={`tl-row type-${task.type} ${t.done ? 'is-done' : ''} ${t.bounce ? 'bounce' : ''}`}
      onAnimationEnd={(e) => e.target === e.currentTarget && t.setBounce(false)}
    >
      <p className="tl-time">
        {when.main}
        {when.yours && <small>{when.yours}</small>}
      </p>
      <span className="tl-dot" aria-hidden />
      <div className="tl-main">
        <p className="tl-title">{task.title}</p>
        <p className="tl-meta">{task.dose || TYPE_WORD[task.type] || 'Care'}</p>
        <TickExtras t={t} task={task} />
      </div>
      <TickButton t={t} title={task.title} />
    </li>
  )
}

function TaskCard({
  task,
  date,
  pet,
  role,
  onSaved,
}: {
  task: DayTask
  date: string
  pet: Pet
  role: Role
  onSaved: () => void
}) {
  if (role === 'owner') return <OwnerTaskCard task={task} date={date} pet={pet} />
  return <CaretakerTaskCard task={task} date={date} pet={pet} onSaved={onSaved} />
}

/** "30 min late", "2 h 10 min late", "1 day late". */
export function lateText(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${Math.max(1, min)} min late`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''} late`
  const days = Math.floor(min / (24 * 60))
  return `${days} day${days === 1 ? '' : 's'} late`
}

/** Owner view of a task: done (by whom, when, photo), couldn't do (why), overdue, or upcoming. */
export function TaskStatus({ task, date, pet }: { task: DayTask; date: string; pet: Pet }) {
  const done = task.checkins.find((c) => c.status === 'done')
  const couldNot = !done && task.checkins.find((c) => c.status === 'could_not')
  const city = pet.home_city || `${pet.name}'s home`
  if (done) {
    const t = stampFor(done.created_at, pet, 'owner', false)
    return (
      <div className="status status-done">
        <span className="status-icon" aria-hidden>
          <Icon name="check" size={14} />
        </span>
        <div className="status-text">
          <p>
            Done by {done.caretaker_name || pet.caretaker_name || 'the caretaker'} · {t.main} in {city}
            {t.yours && <span className="your-time"> ({t.yours} for you)</span>}
          </p>
          {done.note && <p className="status-note">“{done.note}”</p>}
        </div>
        {done.photo_url && (
          <a href={done.photo_url} target="_blank" rel="noreferrer">
            <img className="status-photo" src={done.photo_url} alt={`${task.title} photo`} />
          </a>
        )}
      </div>
    )
  }
  if (couldNot) {
    return (
      <div className="status status-couldnt">
        <span className="status-icon" aria-hidden>
          !
        </span>
        <p className="status-text">
          <b>Couldn't do it</b> · {couldNot.reason}
        </p>
      </div>
    )
  }
  const late = Date.now() - wallToDate(date, task.time, pet.home_timezone).getTime()
  return late > 0 ? (
    <span className="status-tag late">Not done yet · {lateText(late)}</span>
  ) : (
    <span className="status-tag upcoming">Due at {formatTime(task.time)}</span>
  )
}

/** Owner: a read-only task card. Owners change the schedule (Edit / Set up with AI), not the check-ins. */
function OwnerTaskCard({ task, date, pet }: { task: DayTask; date: string; pet: Pet }) {
  const look = TASK_LOOK[task.type]
  const done = task.checkins.some((c) => c.status === 'done')
  return (
    <li className={`task card task-readonly ${done ? 'is-done' : ''} ${task.type === 'meds' ? 'is-meds' : ''}`}>
      <IconCircle name={look.icon} tone={look.tone} size={40} />
      <div className="task-main">
        <div className="task-head">
          <span className="task-when">
            <WallTime day={date} hhmm={task.time} pet={pet} role="owner" />
          </span>
          <h3>{task.title}</h3>
          <TypeTag type={task.type} />
        </div>
        {task.dose && <p className="dose">Dose: {task.dose}</p>}
        {task.notes && <p className="notes">{task.notes}</p>}
        <TaskStatus task={task} date={date} pet={pet} />
      </div>
    </li>
  )
}

function CaretakerTaskCard({ task, date, pet, onSaved }: { task: DayTask; date: string; pet: Pet; onSaved: () => void }) {
  const role: Role = 'caretaker'
  const [mode, setMode] = useState<CheckinStatus | null>(null)
  const t = useTaskTick(task, date, role, onSaved)
  const { done, bounce, setBounce, confirmMeds } = t
  const look = TASK_LOOK[task.type]
  const isMeds = task.type === 'meds'
  const given = isMeds && done
  const missed = !done && task.checkins.some((c) => c.status === 'could_not')

  return (
    <li
      className={`task card tint-${look.tone} ${done ? 'is-done' : ''} ${missed ? 'is-missed' : ''} ${isMeds ? 'is-meds' : ''} ${bounce ? 'bounce' : ''}`}
      onAnimationEnd={(e) => e.target === e.currentTarget && setBounce(false)}
    >
      <TickButton t={t} title={task.title} />

      <div className="task-main">
        <div className="task-head">
          <span className="task-when">
            <WallTime day={date} hhmm={task.time} pet={pet} role={role} />
          </span>
          <IconCircle name={look.icon} tone={look.tone} size={30} />
          <h3>{task.title}</h3>
          <TypeTag type={task.type} />
        </div>
        {task.dose && <p className="dose">Dose: {task.dose}</p>}
        {task.notes && <p className="notes">{task.notes}</p>}

        {task.checkins.length > 0 && (
          <ul className="checkin-list">
            {task.checkins.map((c) => (
              <CheckinLine key={c.id} c={c} pet={pet} role={role} />
            ))}
          </ul>
        )}

        <TickExtras t={t} task={task} />

        {given ? (
          <p className="locked">🔒 Dose given. A second dose for this time slot is blocked.</p>
        ) : mode ? (
          <CheckinForm
            task={task}
            date={date}
            status={mode}
            role={role}
            onCancel={() => setMode(null)}
            onSaved={(status) => {
              setMode(null)
              if (status === 'done') setBounce(true)
              onSaved()
            }}
            onBlocked={onSaved}
          />
        ) : (
          !confirmMeds && (
            <div className="task-links">
              <button className="link-btn" onClick={() => setMode('done')}>
                {done ? 'Add another note or photo' : 'Tick with a note or photo'}
              </button>
              {!done && (
                <button className="link-btn" onClick={() => setMode('could_not')}>
                  Couldn't do it
                </button>
              )}
            </div>
          )
        )}
      </div>
    </li>
  )
}

export function CheckinLine({ c, pet, role, showTask = false }: { c: Checkin; pet: Pet; role: Role; showTask?: boolean }) {
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
            · <When t={stampFor(c.created_at, pet, role)} />
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
  role,
  onCancel,
  onSaved,
  onBlocked,
}: {
  task: DayTask
  date: string
  status: CheckinStatus
  role: Role
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
      await api.checkIn({ task_id: task.id, slot_date: date, status, reason, note, photo, role })
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
                <CheckinLine key={c.id} c={c} pet={pet} role={role} showTask />
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
