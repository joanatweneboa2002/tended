// Time-zone math with no imports, so the app and the tests run the very same
// code (tests/safety_tests.py runs this file directly with Node).

/** Milliseconds that `tz` is ahead of UTC at instant `ts`. */
export function tzOffset(ts: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - Math.floor(ts / 1000) * 1000
}

/** A wall-clock date + HH:MM in `tz`, as a real instant. */
export function wallToDate(isoDay: string, hhmm: string, tz: string): Date {
  const [y, m, d] = isoDay.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const first = guess - tzOffset(guess, tz)
  const second = guess - tzOffset(first, tz) // corrects across DST changes
  return new Date(second)
}

/** The date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export function hourIn(tz: string, at: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(at))
}

export function greeting(tz: string, at: Date = new Date()): string {
  const h = hourIn(tz, at)
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function timeIn(d: Date, tz: string): string {
  return d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
}

export function dayIn(d: Date, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return d.toLocaleDateString('en-US', { timeZone: tz, ...opts })
}

export interface Gap {
  minutes: number // how far `there` is ahead of `here` (negative = behind)
  text: string // "4 hours ahead of you", "1 hour behind you", "same time as you"
  dayNote: string | null // "already Monday there" / "still Sunday there" when the date differs
}

/** How far the clock in `there` is from the clock in `here`, right now (or `at`). */
export function gap(there: string, here: string, at: Date = new Date()): Gap {
  const minutes = Math.round((tzOffset(at.getTime(), there) - tzOffset(at.getTime(), here)) / 60000)
  const hours = Math.abs(minutes) / 60
  const whole = Math.floor(hours)
  const part = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[hours - whole] ?? ''
  const amount = `${whole || !part ? whole : ''}${part}`
  const text = minutes === 0 ? 'same time as you' : `${amount} ${hours > 1 ? 'hours' : 'hour'} ${minutes > 0 ? 'ahead of' : 'behind'} you`
  const thereDay = dayIn(at, there, { weekday: 'long' })
  const dayNote = thereDay === dayIn(at, here, { weekday: 'long' }) ? null : `${minutes > 0 ? 'already' : 'still'} ${thereDay} there`
  return { minutes, text, dayNote }
}
