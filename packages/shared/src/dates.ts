// Calendar-date and timezone helpers. Dates without a time are ISO strings
// (`YYYY-MM-DD`); instants are Date objects. Timezone conversion uses
// date-fns-tz so DST is handled by the IANA database.
import { fromZonedTime, toZonedTime, formatInTimeZone, getTimezoneOffset } from 'date-fns-tz'

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

// The calendar date it is right now in a timezone.
export function todayIn(tz: string, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd')
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

// The same day `months` calendar months later, moved back to the month's last
// day when it is shorter (Jan 31 + 1 month = Feb 28).
export function addMonths(date: string, months: number): string {
  const y = +date.slice(0, 4)
  const m = +date.slice(5, 7) - 1 + months
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(+date.slice(8, 10), last))).toISOString().slice(0, 10)
}

// Whole calendar months from `from` to `to`, counting a month once `to`
// reaches the same day of the month (Jan 15 → Feb 14 is 0, → Feb 15 is 1).
export function monthsBetween(from: string, to: string): number {
  const months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7))
  if (months > 0 && addMonths(from, months) > to) return months - 1
  if (months < 0 && addMonths(from, months) < to) return months + 1
  return months
}

// 0 = Sunday … 6 = Saturday, for a calendar date.
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

// The instant a local wall-clock time on a date happens in a timezone. A time
// skipped by a DST jump resolves forward the way the IANA rules do.
export function zonedInstant(date: string, time: string, tz: string): Date {
  const guess = fromZonedTime(`${date}T${time}:00`, tz)
  if (formatInTimeZone(guess, tz, 'yyyy-MM-dd\'T\'HH:mm') === `${date}T${time}`) return guess
  // Skipped wall time: read it with the offset in force before the jump.
  const offsetBefore = getTimezoneOffset(tz, new Date(guess.getTime() - 86_400_000))
  return new Date(Date.parse(`${date}T${time}:00Z`) - offsetBefore)
}

export function localDateOf(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd')
}

export function localTimeOf(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, 'HH:mm')
}

export function toZoned(instant: Date, tz: string): Date {
  return toZonedTime(instant, tz)
}

export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  // DATE columns come back from postgres.js as UTC-midnight Dates.
  return value.toISOString().slice(0, 10)
}
