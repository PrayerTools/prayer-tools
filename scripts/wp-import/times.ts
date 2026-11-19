// WordPress keeps one row per prayer time: the rows a recurring rule generated
// (tagged with the rule's id) and times picked one by one. Its reminders and
// coverage read those rows, not the rule, so the rows are what convert: each
// run of one local time of day with no missing day becomes a v3 rule, and
// picked times outside any run become a date list.
import { addDays, daysBetween, localDateOf, localTimeOf, weekdayOf } from '@prayertools/shared/dates'

export interface TimeRow { begin: number, end: number }

export interface RulePlan {
  frequency: 'daily' | 'weekly' | 'monthly'
  days: number[]
  // Monthly: the day of the month, or null for the first of the weekday in `days`.
  dayOfMonth?: number | null
  time: string
  startsOn: string
  endsOn: string
  lastAt: Date
  minutes: number
  // The last run of a rule that still exists: it may run on past its last row.
  open: boolean
}

export interface TimesPlan {
  rules: RulePlan[]
  dates: { times: Date[], minutes: number } | null
  pickedAsRules: number
  duplicates: number
}

interface Slot { at: Date, day: string, clock: string, minutes: number }

const minutesOf = (r: TimeRow) => Math.max(1, Math.round((r.end - r.begin) / 60))

function slots(rows: TimeRow[], tz: string): Slot[] {
  const seen = new Set<number>()
  return [...rows].sort((a, b) => a.begin - b.begin).filter(r => !seen.has(r.begin) && seen.add(r.begin)).map((r) => {
    const at = new Date(r.begin * 1000)
    return { at, day: localDateOf(at, tz), clock: localTimeOf(at, tz), minutes: minutesOf(r) }
  })
}

function toRule(run: Slot[], step: 1 | 7, open: boolean): RulePlan {
  const first = run[0]!
  const last = run[run.length - 1]!
  return {
    frequency: step === 7 ? 'weekly' : 'daily',
    days: step === 7 ? [weekdayOf(first.day)] : [],
    time: first.clock,
    startsOn: first.day,
    endsOn: last.day,
    lastAt: last.at,
    minutes: Math.max(...run.map(s => s.minutes)),
    open
  }
}

// Splits a rule's rows wherever the time of day changes or a day is missing.
export function ruleRuns(rows: TimeRow[], tz: string, frequency: 'daily' | 'weekly' | null, ruleExists: boolean): RulePlan[] {
  const s = slots(rows, tz)
  if (!s.length) return []
  // A deleted rule's frequency shows in the spacing of its rows.
  const step: 1 | 7 = frequency === 'weekly' || (!frequency && s.length > 1 && daysBetween(s[0]!.day, s[1]!.day) === 7) ? 7 : 1
  const runs: Slot[][] = []
  for (const slot of s) {
    const run = runs[runs.length - 1]
    const prev = run?.[run.length - 1]
    if (run && prev && prev.clock === slot.clock && daysBetween(prev.day, slot.day) === step) run.push(slot)
    else runs.push([slot])
  }
  return runs.map((run, i) => toRule(run, step, ruleExists && i === runs.length - 1))
}

// Weekly rules on different weekdays merge when one rule with all of them,
// over their combined dates, holds exactly the same times: each covers every
// occurrence of its weekday in that span.
function mergeWeekly(rules: RulePlan[]): RulePlan[] {
  const exact = (members: RulePlan[]) => {
    const from = members.reduce((d, m) => (m.startsOn < d ? m.startsOn : d), members[0]!.startsOn)
    const to = members.reduce((d, m) => (m.endsOn > d ? m.endsOn : d), members[0]!.endsOn)
    return members.every((m) => {
      const wd = m.days[0]!
      return addDays(from, (wd - weekdayOf(from) + 7) % 7) === m.startsOn && addDays(to, -((weekdayOf(to) - wd + 7) % 7)) === m.endsOn
    })
  }
  const groups: RulePlan[][] = []
  for (const r of [...rules].sort((a, b) => a.startsOn.localeCompare(b.startsOn))) {
    const group = groups.find(g => g[0]!.time === r.time && g[0]!.minutes === r.minutes && !g.some(m => m.days[0] === r.days[0]) && exact([...g, r]))
    if (group) group.push(r)
    else groups.push([r])
  }
  return groups.map((g) => {
    if (g.length === 1) return g[0]!
    const last = g.reduce((a, b) => (b.lastAt > a.lastAt ? b : a))
    return { ...g[0]!, days: g.map(m => m.days[0]!).sort((a, b) => a - b), startsOn: g.reduce((d, m) => (m.startsOn < d ? m.startsOn : d), g[0]!.startsOn), endsOn: last.endsOn, lastAt: last.lastAt }
  })
}

// Picked times with a pattern become rules: days in a row at one time of day
// are daily, the same weekday week after week is weekly. The rest stay dates.
export function pickedPlan(picked: TimeRow[], ruleBegins: Set<number>, tz: string): TimesPlan {
  const kept = picked.filter(r => !ruleBegins.has(r.begin))
  const duplicates = picked.length - kept.length
  const byClock = new Map<string, Slot[]>()
  for (const s of slots(kept, tz)) byClock.set(s.clock, [...(byClock.get(s.clock) ?? []), s])

  const rules: RulePlan[] = []
  const weekly: RulePlan[] = []
  const left: Slot[] = []
  let pickedAsRules = 0
  for (const group of byClock.values()) {
    const rest: Slot[] = []
    let run: Slot[] = []
    const flush = () => {
      if (run.length >= 2) { rules.push(toRule(run, 1, false)); pickedAsRules += run.length } else rest.push(...run)
      run = []
    }
    for (const s of group) {
      const prev = run[run.length - 1]
      if (prev && daysBetween(prev.day, s.day) !== 1) flush()
      run.push(s)
    }
    flush()
    const byWeekday = new Map<number, Slot[]>()
    for (const s of rest) byWeekday.set(weekdayOf(s.day), [...(byWeekday.get(weekdayOf(s.day)) ?? []), s])
    for (const days of byWeekday.values()) {
      let wrun: Slot[] = []
      const wflush = () => {
        if (wrun.length >= 2) { weekly.push(toRule(wrun, 7, false)); pickedAsRules += wrun.length } else left.push(...wrun)
        wrun = []
      }
      for (const s of days) {
        const prev = wrun[wrun.length - 1]
        if (prev && daysBetween(prev.day, s.day) !== 7) wflush()
        wrun.push(s)
      }
      wflush()
    }
  }
  rules.push(...mergeWeekly(weekly))
  left.sort((a, b) => a.at.getTime() - b.at.getTime())
  return {
    rules,
    dates: left.length ? { times: left.map(s => s.at), minutes: Math.max(...left.map(s => s.minutes)) } : null,
    pickedAsRules,
    duplicates
  }
}

// Monthly campaigns remind monthly only: a weekly time becomes the first of
// that weekday each month, a daily one the 1st, at the same time of day.
// Rules that become the same monthly time merge, over all their dates.
export function toMonthly(rules: RulePlan[]): RulePlan[] {
  const out = new Map<string, RulePlan>()
  for (const r of rules) {
    const m: RulePlan = r.frequency === 'weekly'
      ? { ...r, frequency: 'monthly', days: [r.days[0]!], dayOfMonth: null }
      : { ...r, frequency: 'monthly', days: [], dayOfMonth: 1 }
    const key = `${m.time}|${m.dayOfMonth}|${m.days.join(',')}|${m.minutes}`
    const prev = out.get(key)
    if (!prev) { out.set(key, m); continue }
    if (m.startsOn < prev.startsOn) prev.startsOn = m.startsOn
    if (m.endsOn > prev.endsOn) { prev.endsOn = m.endsOn; prev.lastAt = m.lastAt }
    prev.open = prev.open || m.open
  }
  return [...out.values()]
}
