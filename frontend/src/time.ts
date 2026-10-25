// Time zones. Everyone sees the pet's home time first: the caretaker is with
// the pet, and the pet's day runs on home time. The owner (often travelling)
// also sees their own time, smaller, next to it.
// Schedule and appointment times are stored as wall-clock times in the pet's
// home zone; check-ins, messages and health entries are stored in UTC.

import { formatTime, type Pet, type Role } from './api'
import { dayIn, timeIn, tzOffset, wallToDate } from './zones'

export { dayIn, gap, greeting, hourIn, timeIn, todayIn, tzOffset, wallToDate } from './zones'

/** The owner's own zone, when it's worth showing next to home time
 *  (owner view, and the clocks actually differ right now). */
export function yourTz(pet: Pet, role: Role): string | null {
  if (role !== 'owner' || pet.owner_timezone === pet.home_timezone) return null
  const now = Date.now()
  return tzOffset(now, pet.owner_timezone) === tzOffset(now, pet.home_timezone) ? null : pet.owner_timezone
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
