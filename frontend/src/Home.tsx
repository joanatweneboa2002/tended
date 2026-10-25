import { useCallback, useEffect, useState } from 'react'
import { api, formatDate, type Alert, type CheckRun, type Dashboard, type Message, type Pet, type Role } from './api'
import { AlertStack, type AlertItem } from './AlertStack'
import { AppointmentSummary } from './Appointments'
import { AskTendedButton } from './AskTended'
import { CheckCard, SuggestionsCard, useLatestCheck } from './CheckPanel'
import { GreetBlob, PawDoodle } from './Doodles'
import { IconCircle, TASK_LOOK, type IconName, type Tone } from './Icons'
import { ProgressRing } from './ProgressRing'
import { greeting, stamp, timeIn, wallForViewer } from './time'
import { TypeTag } from './TypeTag'

export type Tab = 'home' | 'schedule' | 'health' | 'messages' | 'appointments' | 'profile'

const REFRESH_MS = 10000

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
  return role === 'caretaker' ? <CaretakerHome d={data} pet={pet} go={go} /> : <OwnerHome d={data} pet={pet} go={go} now={loadedAt} onOpenActivity={onOpenActivity} />
}

// ---------------------------------------------------------------------------

function CaretakerHome({ d, pet, go }: { d: Dashboard; pet: Pet; go: (t: Tab) => void }) {
  const tz = pet.home_timezone
  const next = d.next_task
  return (
    <div className="dash">
      <section className="card greet">
        <GreetBlob />
        <PawDoodle className="greet-paw" size={34} rotate={16} />
        <div className="greet-row">
          <div className="greet-text">
            <p className="kicker">{formatDate(d.today, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <h1>
              {greeting(tz)}, {pet.caretaker_name || 'there'}
            </h1>
            <p className="muted">Here's {pet.name}'s day.</p>
          </div>
          <ProgressRing done={d.progress.done} total={d.progress.total} />
        </div>
        <div className="greet-actions">
          <AskTendedButton pet={pet} />
          <span className="muted small">Questions about {pet.name}? Ask here first.</span>
        </div>
      </section>

      <AlertStack alerts={todayAlerts(d.alerts)} tz={tz} emptyText="Nothing needs attention right now." />

      <SuggestionsCard pet={pet} />

      <section className={`card tile tint-${next ? TASK_LOOK[next.type].tone : 'yellow'}`}>
        <TileHead title="Next up" icon={next ? TASK_LOOK[next.type].icon : 'clipboard'} tone={next ? TASK_LOOK[next.type].tone : 'yellow'}
          action="See schedule" onAction={() => go('schedule')} />
        {next ? (
          <div className="next-task">
            <span className="next-time">{wallForViewer(d.today, next.time, pet, 'caretaker').main}</span>
            <div>
              <div className="task-head">
                <strong>{next.title}</strong>
                <TypeTag type={next.type} />
              </div>
              {next.dose && <p className="dose">Dose: {next.dose}</p>}
              {next.notes && <p className="notes small">{next.notes}</p>}
              <button className="btn primary small" onClick={() => go('schedule')}>
                Check in
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">
            {d.progress.total === 0 ? 'Nothing scheduled today.' : 'Nothing else coming up today.'}
          </p>
        )}
      </section>

      <div className="tile-grid">
        <NextAppointment d={d} pet={pet} role="caretaker" go={go} />
        <LatestMessage msg={d.latest_message} unread={d.unread_messages} tz={tz} role="caretaker" go={go} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function OwnerHome({ d, pet, go, now, onOpenActivity }: { d: Dashboard; pet: Pet; go: (t: Tab) => void; now: Date; onOpenActivity: () => void }) {
  const { check, setCheck } = useLatestCheck(pet.id)
  const tz = pet.owner_timezone
  const photo = d.latest_photo_checkin
  const last = d.latest_checkin
  return (
    <div className="dash">
      <AlertStack alerts={[...watchAlerts(check), ...todayAlerts(d.alerts)]} tz={tz} emptyText="Nothing needs attention right now." />
      <section className="card greet">
        <GreetBlob />
        <PawDoodle className="greet-paw" size={34} rotate={16} />
        <div className="greet-row">
          <div className="greet-text">
            <p className="kicker">
              {pet.name}'s day · {formatDate(d.today, { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
            <h1>How today is going</h1>
            <p className="muted small">
              It's {timeIn(now, pet.home_timezone)} where {pet.name} is and {timeIn(now, tz)} for you.
            </p>
          </div>
          <ProgressRing done={d.progress.done} total={d.progress.total} />
        </div>
        <ul className="today-dots">
          {d.tasks.map((t) => (
            <li key={t.id} className={`dot-${t.state}`} title={t.state}>
              <span className="dot" aria-hidden />
              <span className="dot-time">{wallForViewer(d.today, t.time, pet, 'owner').main}</span>
              <span>{t.title}</span>
              <span className="sr-only">
                {t.state === 'done' ? 'done' : t.state === 'could_not' ? "couldn't do it" : 'not yet'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <CheckCard pet={pet} check={check} onCheck={setCheck} onOpenActivity={onOpenActivity} />

      <div className="tile-grid">
        <section className={`card tile tint-${last ? TASK_LOOK[last.task_type].tone : 'yellow'}`}>
          <TileHead title="Latest check-in" icon={last ? TASK_LOOK[last.task_type].icon : 'clipboard'}
            tone={last ? TASK_LOOK[last.task_type].tone : 'yellow'} action="History" onAction={() => go('schedule')} />
          {last ? (
            <div className="latest-checkin">
              <p>
                <strong>
                  {last.task_title}: {last.status === 'done' ? (last.task_type === 'meds' ? 'dose given' : 'done') : "couldn't do it"}
                </strong>
              </p>
              {last.reason && <p className="reason">Reason: {last.reason}</p>}
              {last.note && <p>{last.note}</p>}
              <p className="muted small">
                {stamp(last.created_at, tz)}
                {last.caretaker_name && ` · ${last.caretaker_name}`}
              </p>
            </div>
          ) : (
            <p className="muted">No check-ins yet.</p>
          )}
          {photo?.photo_url ? (
            <figure className="latest-photo">
              <img src={photo.photo_url} alt={`${photo.task_title} photo`} />
              <figcaption className="muted small">
                {photo.task_title} · {stamp(photo.created_at, tz)}
              </figcaption>
            </figure>
          ) : (
            <p className="photo-empty muted small">No photos yet. They'll show here when the caretaker adds one.</p>
          )}
        </section>

        <HealthSnapshot d={d} go={go} />
        <NextAppointment d={d} pet={pet} role="owner" go={go} />
        <LatestMessage msg={d.latest_message} unread={d.unread_messages} tz={tz} role="owner" go={go} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function TileHead({ title, icon, tone, action, onAction, badge }: {
  title: string
  icon: IconName
  tone: Tone
  action?: string
  onAction?: () => void
  badge?: number
}) {
  return (
    <div className="tile-head">
      <h2>
        <IconCircle name={icon} tone={tone} size={38} />
        {title}
        {!!badge && <span className="count-badge">{badge}</span>}
      </h2>
      {action && (
        <button className="link-btn" onClick={onAction}>
          {action} ›
        </button>
      )}
    </div>
  )
}

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
    <section className="card tile tint-violet">
      <TileHead title="Next appointment" icon="calendar" tone="violet" action="All" onAction={() => go('appointments')} />
      {d.next_appointment ? (
        <>
          <AppointmentSummary a={d.next_appointment} pet={pet} role={role} />
          {d.next_appointment.bring && (
            <p className="appt-bring small">
              <b>Bring:</b> {d.next_appointment.bring}
            </p>
          )}
        </>
      ) : (
        <p className="muted">Nothing booked.</p>
      )}
    </section>
  )
}

function LatestMessage({ msg, unread, tz, role, go }: { msg: Message | null; unread: number; tz: string; role: Role; go: (t: Tab) => void }) {
  return (
    <section className="card tile tint-blue">
      <TileHead title="Latest message" icon="chat" tone="blue" action="Open chat" onAction={() => go('messages')} badge={unread} />
      {msg ? (
        <button className="msg-preview" onClick={() => go('messages')}>
          <span className="muted small">
            {msg.sender_role === role ? 'You' : msg.sender_name} · {stamp(msg.created_at, tz)}
          </span>
          <span className="msg-text">{msg.photo_url && !msg.text ? '📷 Photo' : msg.text}</span>
        </button>
      ) : (
        <p className="muted">No messages yet.</p>
      )}
    </section>
  )
}

const LEVEL_WORD: Record<string, string> = {
  none: 'None', some: 'Some', normal: 'Normal', less: 'Less', more: 'More', low: 'Low', high: 'High', off: 'Off',
}

function HealthSnapshot({ d, go }: { d: Dashboard; go: (t: Tab) => void }) {
  const h = d.health
  const rows: { label: string; value: string; when?: string; flag?: boolean }[] = []
  if (h.weight) {
    const change = h.weight.change
    rows.push({
      label: 'Weight',
      value: `${h.weight.value} ${h.weight.unit}${change ? ` (${change > 0 ? '+' : ''}${change} since ${formatDate(h.weight.since!, { weekday: 'short' })})` : ''}`,
      when: h.weight.date,
      flag: change != null && change < 0,
    })
  }
  const add = (label: string, v: { value: string; date: string } | null, bad: string[]) =>
    v && rows.push({ label, value: LEVEL_WORD[v.value] ?? v.value, when: v.date, flag: bad.includes(v.value) })
  add('Appetite', h.appetite, ['none', 'some'])
  add('Energy', h.energy, ['low'])
  add('Water', h.water, ['less', 'more'])
  add('Potty', h.potty, ['off'])

  return (
    <section className="card tile tint-mint">
      <TileHead title="Health snapshot" icon="heartPulse" tone="mint" action="Health log" onAction={() => go('health')} />
      {rows.length === 0 ? (
        <p className="muted">Nothing logged in the last week.</p>
      ) : (
        <dl className="snapshot">
          {rows.map((r) => (
            <div key={r.label} className={r.flag ? 'flag' : ''}>
              <dt>{r.label}</dt>
              <dd>
                {r.value}
                {r.when && <span className="muted small"> · {d.today === r.when ? 'today' : formatDate(r.when, { weekday: 'short' })}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {h.symptoms && (
        <p className="symptoms small">
          “{h.symptoms.value}” <span className="muted">· {formatDate(h.symptoms.date, { weekday: 'short' })}</span>
        </p>
      )}
    </section>
  )
}
