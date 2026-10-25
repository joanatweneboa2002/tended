import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, api, formatDate, formatTime, type Alert, type Checkin, type CheckRun, type Dashboard, type DashTask, type Message, type Pet, type Role } from './api'
import { AlertStack, type AlertItem } from './AlertStack'
import { AppointmentSummary } from './Appointments'
import { AskTendedButton } from './AskTended'
import { CheckCard, SuggestionsCard, useLatestCheck } from './CheckPanel'
import { Icon, IconCircle, TASK_LOOK, type IconName, type Tone } from './Icons'
import { PetAvatar } from './PetAvatar'
import { ProgressRing } from './ProgressRing'
import { TickExtras, TodoRow, useTaskTick } from './Schedule'
import { dayIn, gap, greeting, stampFor, timeIn, todayIn, yourTz } from './time'
import { When } from './ui'

export type Tab = 'home' | 'schedule' | 'health' | 'messages' | 'appointments' | 'profile'

const REFRESH_MS = 10000
const UNDO_MS = 120_000

export function Home({ pet, role, go, onOpenActivity }: { pet: Pet; role: Role; go: (t: Tab) => void; onOpenActivity: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [loadedAt, setLoadedAt] = useState(() => new Date())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.dashboard(pet.id, role).then(
      (d) => {
        setData(d)
        setLoadedAt(new Date())
        setError(null)
      },
      (e) => setError(e.message),
    )
  }, [pet.id, role])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  if (error) return <p className="error card">{error}</p>
  if (!data) return <p className="empty">Loading…</p>
  return role === 'caretaker' ? (
    <CaretakerHome d={data} pet={pet} go={go} now={loadedAt} reload={load} />
  ) : (
    <OwnerHome d={data} pet={pet} go={go} now={loadedAt} reload={load} onOpenActivity={onOpenActivity} />
  )
}

// ---------------------------------------------------------------------------

function CaretakerHome({ d, pet, go, now, reload }: { d: Dashboard; pet: Pet; go: (t: Tab) => void; now: Date; reload: () => void }) {
  const alerts = todayAlerts(d.alerts)
  // Ticking "Next up" swaps the card for the following task, so its undo lives here.
  const [undo, setUndo] = useState<{ id: number; title: string } | null>(null)
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [undo])
  const rest = d.tasks.filter((t) => t.id !== d.next_task?.id)
  return (
    <div className="dash">
      <Hero d={d} pet={pet} role="caretaker" now={now} urgent={alerts.some((a) => a.level === 'urgent')} go={go} />
      <AlertStack alerts={alerts} pet={pet} role="caretaker" emptyText="Nothing needs attention right now." />
      <NextUp d={d} pet={pet} reload={reload} onTicked={(id, title) => setUndo({ id, title })} />
      {undo && (
        <p className="undo-toast" role="status">
          <span>
            <b>{undo.title}</b> ticked off
          </span>
          <button
            className="link-btn"
            onClick={async () => {
              setUndo(null)
              await api.undoCheckin(undo.id).catch(() => {})
              reload()
            }}
          >
            Undo
          </button>
        </p>
      )}
      <AskTendedButton pet={pet} variant="card" />
      {rest.length > 0 && <Timeline title="Rest of today" tasks={rest} d={d} pet={pet} role="caretaker" go={go} reload={reload} />}
      <SuggestionsCard pet={pet} />
      <NextAppointment d={d} pet={pet} role="caretaker" go={go} />
      <LatestMessage msg={d.latest_message} unread={d.unread_messages} pet={pet} role="caretaker" go={go} />
    </div>
  )
}

function OwnerHome({ d, pet, go, now, reload, onOpenActivity }: {
  d: Dashboard
  pet: Pet
  go: (t: Tab) => void
  now: Date
  reload: () => void
  onOpenActivity: () => void
}) {
  const { check, setCheck } = useLatestCheck(pet.id)
  const alerts = [...watchAlerts(check), ...todayAlerts(d.alerts)]
  return (
    <div className="dash">
      <Hero d={d} pet={pet} role="owner" now={now} urgent={alerts.some((a) => a.level === 'urgent')} go={go} />
      <AlertStack alerts={alerts} pet={pet} role="owner" emptyText="Nothing needs attention right now." />
      <QuickStats d={d} go={go} />
      <Timeline title="Today" tasks={d.tasks} d={d} pet={pet} role="owner" go={go} reload={reload} />
      <CheckCard pet={pet} check={check} onCheck={setCheck} onOpenActivity={onOpenActivity} />
      <PhotoDiary pet={pet} />
      <NextAppointment d={d} pet={pet} role="owner" go={go} />
      <LatestMessage msg={d.latest_message} unread={d.unread_messages} pet={pet} role="owner" go={go} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero: sky card with a wavy edge, the pet's name, a status line, a time pill,
// the photo in a blob that pokes out of the top, and the day's progress ring.
// ---------------------------------------------------------------------------

function status(d: Dashboard, urgent: boolean): string {
  const { done, total } = d.progress
  if (urgent) return 'Needs a look today'
  if (!total) return 'A free day today'
  if (done === total) return 'All done for today'
  if (done === 0) return 'Just getting started'
  return 'Having a quiet day'
}

function petFacts(pet: Pet): string {
  const age = pet.age_years != null ? `${pet.age_years} ${pet.age_years === 1 ? 'year' : 'years'}` : ''
  return [pet.breed || pet.species, age].filter(Boolean).join(' · ')
}

/** Both places: where the pet is, how far that is from the owner, and the clocks.
 *  Owners see the pet's time first and theirs smaller; caretakers only the pet's. */
function Places({ pet, role, now }: { pet: Pet; role: Role; now: Date }) {
  const city = pet.home_city || `${pet.name}'s home`
  const home = timeIn(now, pet.home_timezone)
  if (role === 'caretaker') {
    const g = gap(pet.owner_timezone, pet.home_timezone, now)
    return (
      <div className="hero-places">
        <p className="place-line">
          {pet.name} is with you in {city} {pet.home_flag}
        </p>
        <p className="place-sub">
          {pet.owner_name || 'The owner'} is in {pet.owner_city || 'another city'} {pet.owner_flag} · {g.text.replace(' you', '')}
        </p>
        <p className="time-pill">
          {greeting(pet.home_timezone, now)}, {pet.caretaker_name || 'there'} · <b>{home}</b>
        </p>
      </div>
    )
  }
  const g = gap(pet.home_timezone, pet.owner_timezone, now)
  const day = (tz: string) => dayIn(now, tz, { weekday: 'short' })
  const differentDay = !!g.dayNote
  return (
    <div className="hero-places">
      <p className="place-line">
        {pet.name} is in {city} {pet.home_flag} · {g.text}
      </p>
      {g.dayNote && <p className="place-sub">It's {g.dayNote.replace(' there', '')} in {city}</p>}
      <p className="time-pill">
        <b>
          {home}
          {differentDay && ` ${day(pet.home_timezone)}`}
        </b>{' '}
        in {city}
        {yourTz(pet, role) && (
          <small>
            {' '}
            · {timeIn(now, pet.owner_timezone)}
            {differentDay && ` ${day(pet.owner_timezone)}`} for you in {pet.owner_city || 'your city'}
          </small>
        )}
      </p>
    </div>
  )
}

function Hero({ d, pet, role, now, urgent, go }: { d: Dashboard; pet: Pet; role: Role; now: Date; urgent: boolean; go: (t: Tab) => void }) {
  return (
    <section className="hero">
      <div className="hero-text">
        <h1>{pet.name}</h1>
        <p className="hero-status">{status(d, urgent)}</p>
        <p className="hero-facts">
          {petFacts(pet)}
          {pet.is_sample && <span className="badge sample">Sample</span>}
        </p>
      </div>
      <Places pet={pet} role={role} now={now} />
      <div className="hero-media">
        <button className="hero-photo" onClick={() => go('profile')} aria-label={`Open ${pet.name}'s profile`}>
          <PetAvatar pet={pet} size={148} />
        </button>
        <button className="hero-ring" onClick={() => go('schedule')} aria-label={`${d.progress.done} of ${d.progress.total} tasks done. Open the schedule`}>
          <ProgressRing done={d.progress.done} total={d.progress.total} size={68} />
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Quick stats: Food, Meds (or Weight), Mood/Energy
// ---------------------------------------------------------------------------

const LEVEL_WORD: Record<string, string> = {
  none: 'None', some: 'Some', normal: 'Normal', less: 'Less', more: 'More', low: 'Low', high: 'High', off: 'Off',
}

function QuickStats({ d, go }: { d: Dashboard; go: (t: Tab) => void }) {
  const meals = d.tasks.filter((t) => t.type === 'feed')
  const meds = d.tasks.filter((t) => t.type === 'meds')
  const count = (list: DashTask[]) => `${list.filter((t) => t.state === 'done').length}/${list.length}`
  const h = d.health
  const mood = h.energy ?? h.appetite
  const moodWhen = mood ? (mood.date === d.today ? 'today' : formatDate(mood.date, { weekday: 'short' })) : ''
  return (
    <section className="stats" aria-label="Quick stats">
      <Stat icon="bowl" tone="yellow" label="Food" value={meals.length ? count(meals) : 'None'} sub={meals.length ? 'meals done' : 'today'} onClick={() => go('schedule')} />
      {meds.length ? (
        <Stat icon="pill" tone="violet" label="Meds" value={count(meds)} sub="given" onClick={() => go('schedule')} />
      ) : (
        <Stat icon="scale" tone="violet" label="Weight" value={h.weight ? `${h.weight.value}` : '—'} sub={h.weight ? h.weight.unit : 'not logged'} onClick={() => go('health')} />
      )}
      <Stat
        icon="heartPulse"
        tone="mint"
        label={h.energy ? 'Energy' : 'Mood'}
        value={mood ? (LEVEL_WORD[mood.value] ?? mood.value) : '—'}
        sub={mood ? `${h.energy ? '' : 'appetite · '}${moodWhen}` : 'not logged'}
        onClick={() => go('health')}
      />
    </section>
  )
}

function Stat({ icon, tone, label, value, sub, onClick }: { icon: IconName; tone: Tone; label: string; value: string; sub: string; onClick: () => void }) {
  return (
    <button className="stat" onClick={onClick}>
      <span className="stat-top">
        <IconCircle name={icon} tone={tone} size={34} />
        <span className="stat-label">{label}</span>
      </span>
      <b className="stat-value">{value}</b>
      <span className="stat-sub">{sub}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Today: a tickable timeline
// ---------------------------------------------------------------------------

function Timeline({ title, tasks, d, pet, role, go, reload }: {
  title: string
  tasks: DashTask[]
  d: Dashboard
  pet: Pet
  role: Role
  go: (t: Tab) => void
  reload: () => void
}) {
  return (
    <section className="card timeline">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {yourTz(pet, role) && <p className="muted small">{pet.name}'s home time, yours in gray</p>}
        </div>
        <button className="link-btn" onClick={() => go('schedule')}>
          Full schedule ›
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="muted">Nothing scheduled today.</p>
      ) : (
        <ol className="tl">
          {tasks.map((t) => (
            <TodoRow key={t.id} task={t} date={d.today} pet={pet} role={role} onSaved={reload} />
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Caretaker: Next up
// ---------------------------------------------------------------------------

function NextUp({ d, pet, reload, onTicked }: { d: Dashboard; pet: Pet; reload: () => void; onTicked: (id: number, title: string) => void }) {
  if (!d.next_task) {
    const { done, total } = d.progress
    return (
      <section className="card next-up is-clear">
        <p className="kicker">Next up</p>
        <h2 className="next-title">{total ? 'Nothing left today' : 'Nothing scheduled today'}</h2>
        <p className="muted">{total ? `${done} of ${total} things are ticked off. Thank you!` : `Enjoy the time with ${pet.name}.`}</p>
      </section>
    )
  }
  return <NextUpCard key={d.next_task.id} task={d.next_task} date={d.today} reload={reload} onTicked={onTicked} />
}

function NextUpCard({ task, date, reload, onTicked }: { task: DashTask; date: string; reload: () => void; onTicked: (id: number, title: string) => void }) {
  const t = useTaskTick(task, date, 'caretaker', reload, onTicked)
  const fileRef = useRef<HTMLInputElement>(null)
  const look = TASK_LOOK[task.type]
  return (
    <section className={`card next-up ${t.bounce ? 'bounce' : ''}`} onAnimationEnd={(e) => e.target === e.currentTarget && t.setBounce(false)}>
      <p className="kicker">Next up</p>
      <div className="next-row">
        <IconCircle name={look.icon} tone={look.tone} size={54} />
        <div className="next-text">
          <h2 className="next-title">{task.title}</h2>
          <p className="next-time">
            {formatTime(task.time)}
            {task.dose && <span> · {task.dose}</span>}
          </p>
        </div>
      </div>
      {task.notes && <p className="next-notes">{task.notes}</p>}
      {!t.confirmMeds && (
        <div className="next-actions">
          <button className="btn primary big" onClick={() => t.tick()} disabled={t.done || t.busy}>
            <Icon name="check" size={20} /> Mark done
          </button>
          <button className="btn ghost photo-btn" onClick={() => fileRef.current?.click()} disabled={t.done || t.busy}>
            <Icon name="camera" size={20} /> Add photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) t.tick(f)
            }}
          />
        </div>
      )}
      <TickExtras t={t} task={task} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Photo diary (owner): photos the caretaker added when ticking things off
// ---------------------------------------------------------------------------

function PhotoDiary({ pet }: { pet: Pet }) {
  const [photos, setPhotos] = useState<Checkin[] | null>(null)
  useEffect(() => {
    api.checkins(pet.id, addDays(todayIn(pet.home_timezone), -7)).then(
      (list) => setPhotos(list.filter((c) => c.photo_url).slice(0, 10)),
      () => setPhotos([]),
    )
  }, [pet.id, pet.home_timezone])
  if (photos === null) return null
  return (
    <section className="card diary">
      <div className="card-head">
        <h2>{pet.name}'s photo diary</h2>
        <span className="muted small">Last 7 days</span>
      </div>
      {photos.length === 0 ? (
        <p className="muted">Photos {pet.caretaker_name || 'the caretaker'} adds when ticking things off will show up here.</p>
      ) : (
        <ul className="diary-row">
          {photos.map((c) => (
            <li key={c.id} className="diary-item">
              <a href={c.photo_url!} target="_blank" rel="noreferrer">
                <img src={c.photo_url!} alt={`${c.task_title ?? 'Check-in'} photo${c.note ? `: ${c.note}` : ''}`} />
              </a>
              <p>
                <b>{c.task_title}</b>
                <span className="diary-time">
                  <When t={stampFor(c.created_at, pet, 'owner')} />
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

/** Today's simple rule-based alerts, in the shared alert-card shape. */
function todayAlerts(alerts: Alert[]): AlertItem[] {
  return alerts.map((a) => ({ ...a, source: 'Today' }))
}

/** Alerts from the latest Watchdog check (older checks used title/noticed). */
function watchAlerts(check: CheckRun | null | undefined): AlertItem[] {
  return (check?.alerts ?? []).map((a) => ({
    level: a.level,
    topic: a.topic ?? 'other',
    headline: a.headline ?? a.title ?? '',
    action: a.action,
    details: a.details ?? a.noticed ?? '',
    references: a.references,
    source: 'Watchdog',
  }))
}

function NextAppointment({ d, pet, role, go }: { d: Dashboard; pet: Pet; role: Role; go: (t: Tab) => void }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Upcoming appointment</h2>
        <button className="link-btn" onClick={() => go('appointments')}>
          See all ›
        </button>
      </div>
      {d.next_appointment ? (
        <button className="appt-row" onClick={() => go('appointments')}>
          <AppointmentSummary a={d.next_appointment} pet={pet} role={role} />
        </button>
      ) : (
        <div className="photo-empty-state">
          <img src="/pets/puppy.jpg" alt="" />
          <p className="muted">Nothing booked. Add vet or groomer visits in Appointments.</p>
        </div>
      )}
    </section>
  )
}

function LatestMessage({ msg, unread, pet, role, go }: { msg: Message | null; unread: number; pet: Pet; role: Role; go: (t: Tab) => void }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          Latest message
          {!!unread && <span className="count-badge">{unread}</span>}
        </h2>
        <button className="link-btn" onClick={() => go('messages')}>
          Open chat ›
        </button>
      </div>
      {msg ? (
        <button className={`msg-preview from-${msg.sender_role}`} onClick={() => go('messages')}>
          <span className="msg-who">
            {msg.sender_role === role ? 'You' : msg.sender_name} · <When t={stampFor(msg.created_at, pet, role)} />
          </span>
          <span className="msg-text">{msg.photo_url && !msg.text ? '📷 Photo' : msg.text}</span>
        </button>
      ) : (
        <p className="muted">No messages yet.</p>
      )}
    </section>
  )
}
