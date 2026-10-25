// Time zones. Everyone sees the pet's home time first: the caretaker is with
// the pet, and the pet's day runs on home time. The owner (often travelling)
// also sees their own time, smaller, next to it.
// Schedule and appointment times are stored as wall-clock times in the pet's
// home zone; check-ins, messages and health entries are stored in UTC.

import { formatTime, type Pet, type Role } from './api'

/** The owner's own zone, when it's worth showing next to home time
 *  (owner view, and the clocks actually differ right now). */
export function yourTz(pet: Pet, role: Role): string | null {
  if (role !== 'owner' || pet.owner_timezone === pet.home_timezone) return null
  const now = Date.now()
  return tzOffset(now, pet.owner_timezone) === tzOffset(now, pet.home_timezone) ? null : pet.owner_timezone
}

/** Milliseconds that `tz` is ahead of UTC at instant `ts`. */
function tzOffset(ts: number, tz: string): number {
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

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  )
}

export function hourIn(tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
}

export function greeting(tz: string): string {
  const h = hourIn(tz)
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function zoneAbbr(tz: string, at = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? tz
  )
}

export function timeIn(d: Date, tz: string): string {
  return d.toLocaleTimeString(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' })
}

export function dayIn(d: Date, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return d.toLocaleDateString(undefined, { timeZone: tz, ...opts })
}

/** A UTC timestamp shown as "Sat 7:49 AM" in `tz`. */
export function stamp(iso: string, tz: string): string {
  const d = new Date(iso)
  return `${dayIn(d, tz, { weekday: 'short' })} ${timeIn(d, tz)}`
}

/** `instant` in the owner's zone, with the weekday added when it's a different day there. */
function yoursAt(instant: Date, pet: Pet, tz: string): string {
  const day = (z: string) => dayIn(instant, z, { weekday: 'short' })
  return day(tz) === day(pet.home_timezone) ? timeIn(instant, tz) : `${day(tz)} ${timeIn(instant, tz)}`
}

export interface Shown {
  main: string // home time
  yours: string | null // owner's own time (owner view only, when it differs)
}

/** A UTC timestamp for the viewer: home time first, the owner's own time as an extra. */
export function stampFor(iso: string, pet: Pet, role: Role, withDay = true): Shown {
  const d = new Date(iso)
  const tz = yourTz(pet, role)
  return {
    main: withDay ? stamp(iso, pet.home_timezone) : timeIn(d, pet.home_timezone),
    yours: tz ? yoursAt(d, pet, tz) : null,
  }
}

/** A home-time wall clock (schedule task or appointment) for the viewer. */
export function wallForViewer(isoDay: string, hhmm: string, pet: Pet, role: Role): Shown & { day: string } {
  const instant = wallToDate(isoDay, hhmm, pet.home_timezone)
  const tz = yourTz(pet, role)
  return {
    main: formatTime(hhmm),
    yours: tz ? yoursAt(instant, pet, tz) : null,
    day: dayIn(instant, pet.home_timezone, { weekday: 'short', month: 'short', day: 'numeric' }),
  }
}
