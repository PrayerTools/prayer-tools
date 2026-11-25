import type { Cadence } from '@prayertools/shared/db/schema'

export interface CommitmentInput {
  frequency: 'daily' | 'weekly' | 'monthly'
  days_of_week: number[]
  day_of_month: number | null
  time: string
  duration_min: number | null
}

export function newCommitment(rule: 'required' | 'optional' | 'hidden', defaultDuration: number, cadence: Cadence = 'daily'): CommitmentInput {
  return {
    frequency: cadence,
    days_of_week: [],
    day_of_month: cadence === 'monthly' ? 1 : null,
    time: '07:00',
    duration_min: rule === 'hidden' ? null : defaultDuration
  }
}

// What one content entry is called: a day, a week or a month.
export function entryUnit(cadence: Cadence | null | undefined): 'day' | 'week' | 'month' {
  return cadence === 'monthly' ? 'month' : cadence === 'weekly' ? 'week' : 'day'
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function timezones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (list?.length) return list.includes('UTC') ? list : ['UTC', ...list]
  } catch {
    // older engines
  }
  return ['UTC']
}

// "Monday, Wednesday and Friday" for a list of weekdays (0 = Sunday).
export function weekdayList(days: number[], lang: string): string {
  const fmt = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' })
  const names = days.slice().sort().map(d => fmt.format(new Date(Date.UTC(2024, 0, 7 + d))))
  try {
    return new Intl.ListFormat(lang, { type: 'conjunction' }).format(names)
  } catch {
    return names.join(', ')
  }
}

// The i18n key naming the day a monthly rule falls on ("1st of the month").
export function monthDayKey(c: { dayOfMonth?: number | null, day_of_month?: number | null, daysOfWeek?: number[], days_of_week?: number[] }): string {
  const day = c.dayOfMonth ?? c.day_of_month
  return day ? `commitment.month_day_${day}` : `commitment.first_weekday_${(c.daysOfWeek ?? c.days_of_week ?? [])[0] ?? 0}`
}

// "Daily at 07:00" style summary of a rule.
export function describeRule(c: { kind?: string, frequency: string | null, daysOfWeek?: number[], days_of_week?: number[], dayOfMonth?: number | null, day_of_month?: number | null, time: string, dates?: string[] }, lang: string, t: (k: string, p?: Record<string, unknown>) => string): string {
  const time = formatTime(c.time, lang)
  if (c.kind === 'dates') return t('commitment.dates_summary', { n: c.dates?.length ?? 0 })
  if (c.frequency === 'daily') return t('commitment.daily_at', { time })
  if (c.frequency === 'monthly') return t('commitment.monthly_at', { day: t(monthDayKey(c)), time })
  return t('commitment.weekly_at', { days: weekdayList(c.daysOfWeek ?? c.days_of_week ?? [], lang), time })
}

export function formatTime(hhmm: string, lang: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, h, m)))
  } catch {
    return hhmm
  }
}

export function formatMinutes(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(n)
  } catch {
    return `${n} min`
  }
}
