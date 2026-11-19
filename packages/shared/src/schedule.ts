// Commitment rules → real instants. A commitment is a rule (days, local time,
// timezone) or a list of specific instants (24/7 picks); nothing is stored
// per future occurrence. Everything here works in real instants, so DST is
// exact: a local 07:00 in a DST-observing timezone moves in UTC with the
// clock change, which is the behaviour the plan chose (anchor to the
// intercessor's local time).
import type { Cadence, CommitmentKind, Frequency } from './db/schema'
import { addDays, addMonths, daysBetween, localDateOf, monthsBetween, weekdayOf, zonedInstant } from './dates'

export const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly']
// Days of the month a monthly rule can fall on; it can also fall on the first
// of a weekday.
export const MONTH_DAYS = [1, 15]

export interface CommitmentRule {
  kind: CommitmentKind
  frequency: Frequency | null
  days_of_week: number[]
  day_of_month?: number | null
  time: string
  timezone: string
  duration_min: number | null
  dates: (Date | string)[]
  starts_on: string
  ends_on: string | null
  paused?: boolean
}

function matchesDay(rule: CommitmentRule, date: string): boolean {
  if (rule.frequency === 'daily') return true
  if (rule.frequency === 'monthly') {
    const day = +date.slice(8, 10)
    return rule.day_of_month ? day === rule.day_of_month : day <= 7 && rule.days_of_week.includes(weekdayOf(date))
  }
  return rule.days_of_week.includes(weekdayOf(date))
}

// Whether a rule's `days_of_week` names the days it falls on: weekly rules,
// and monthly ones on the first of a weekday.
export function usesWeekdays(rule: { frequency: Frequency | null, day_of_month?: number | null }): boolean {
  return rule.frequency === 'weekly' || (rule.frequency === 'monthly' && !rule.day_of_month)
}

// Occurrence instants of a rule within [from, to).
export function occurrences(rule: CommitmentRule, from: Date, to: Date): Date[] {
  if (rule.kind === 'dates') {
    return rule.dates
      .map(d => new Date(d))
      .filter(d => d >= from && d < to)
      .sort((a, b) => a.getTime() - b.getTime())
  }
  const out: Date[] = []
  let date = localDateOf(from, rule.timezone)
  date = addDays(date, -1)
  if (date < rule.starts_on) date = rule.starts_on
  const last = addDays(localDateOf(to, rule.timezone), 1)
  const end = rule.ends_on && rule.ends_on < last ? rule.ends_on : last
  for (; date <= end; date = addDays(date, 1)) {
    if (!matchesDay(rule, date)) continue
    const at = zonedInstant(date, rule.time, rule.timezone)
    if (at >= from && at < to) out.push(at)
  }
  return out
}

// The first occurrence strictly after `after`, or null when the rule has no
// more (ended, or a date list that is used up).
export function nextOccurrence(rule: CommitmentRule, after: Date): Date | null {
  if (rule.kind === 'dates') {
    const next = rule.dates
      .map(d => new Date(d))
      .filter(d => d > after)
      .sort((a, b) => a.getTime() - b.getTime())[0]
    return next ?? null
  }
  let date = localDateOf(after, rule.timezone)
  if (date < rule.starts_on) date = rule.starts_on
  // A week plus the day before covers every weekly pattern; five weeks plus
  // the day before every monthly one.
  const span = rule.frequency === 'monthly' ? 37 : 9
  for (let i = 0; i < span; i++, date = addDays(date, 1)) {
    if (rule.ends_on && date > rule.ends_on) return null
    if (!matchesDay(rule, date)) continue
    const at = zonedInstant(date, rule.time, rule.timezone)
    if (at > after) return at
  }
  return null
}

// When the reminder email for a commitment is next due. Paused or ended
// commitments have none.
export function nextReminderUtc(rule: CommitmentRule, after: Date = new Date()): Date | null {
  if (rule.paused) return null
  return nextOccurrence(rule, after)
}

// Which content entry (1…N) a date falls on, counting from an anchor date:
// the campaign start (shared calendar) or the person's own start.
// Monthly entries are calendar months from the anchor.
export function entryNumber(anchor: string, cadence: Cadence, date: string): number {
  if (date < anchor) return 0
  if (cadence === 'monthly') return monthsBetween(anchor, date) + 1
  return Math.floor(daysBetween(anchor, date) / (cadence === 'weekly' ? 7 : 1)) + 1
}

export function entryDate(anchor: string, cadence: Cadence, entry: number): string {
  if (cadence === 'monthly') return addMonths(anchor, entry - 1)
  return addDays(anchor, (entry - 1) * (cadence === 'weekly' ? 7 : 1))
}

// Minutes of prayer a rule commits per occurrence, used for the prayer-time goal.
export function committedMinutes(rule: CommitmentRule, defaultMinutes: number): number {
  return rule.duration_min ?? defaultMinutes
}

// Validates a commitment coming from a form or the app. Returns error keys.
export function validateRule(rule: Partial<CommitmentRule>): string[] {
  const errors: string[] = []
  if (rule.kind === 'dates') {
    if (!Array.isArray(rule.dates) || rule.dates.length === 0 || rule.dates.length > 200) errors.push('dates')
    else if (rule.dates.some(d => Number.isNaN(new Date(d).getTime()))) errors.push('dates')
  } else {
    if (!FREQUENCIES.includes(rule.frequency as Frequency)) errors.push('frequency')
    const days = rule.days_of_week ?? []
    const weekdays = days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)
    if (rule.frequency === 'weekly' && (days.length === 0 || !weekdays)) errors.push('days_of_week')
    if (rule.frequency === 'monthly') {
      const ok = rule.day_of_month != null
        ? MONTH_DAYS.includes(rule.day_of_month) && days.length === 0
        : days.length === 1 && weekdays
      if (!ok) errors.push('day_of_month')
    }
  }
  if (!rule.time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) errors.push('time')
  if (rule.duration_min !== null && rule.duration_min !== undefined) {
    if (!Number.isInteger(rule.duration_min) || rule.duration_min < 1 || rule.duration_min > 1440) errors.push('duration_min')
  }
  return errors
}
