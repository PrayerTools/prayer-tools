// 24/7 coverage: the campaign is a grid of real slot instants (15 minutes
// unless the campaign chooses another length) from its start to its end in
// the campaign's timezone (a DST day simply has 92 or 100 15-minute slots). Each commitment occurrence marks the slots it overlaps; coverage is
// the share of slots with at least one intercessor.
import { addDays, zonedInstant } from './dates'
import { occurrences, type CommitmentRule } from './schedule'

export interface CoverageGrid {
  start: Date
  end: Date
  slotMinutes: number
  // Intercessor count per slot.
  slots: number[]
}

export function campaignWindow(startDate: string, endDate: string, tz: string): { start: Date, end: Date } {
  return { start: zonedInstant(startDate, '00:00', tz), end: zonedInstant(addDays(endDate, 1), '00:00', tz) }
}

export function buildGrid(
  startDate: string,
  endDate: string,
  tz: string,
  rules: CommitmentRule[],
  defaultMinutes = 15,
  slotMinutes = 15
): CoverageGrid {
  const { start, end } = campaignWindow(startDate, endDate, tz)
  const slotMs = slotMinutes * 60_000
  const count = Math.max(0, Math.round((end.getTime() - start.getTime()) / slotMs))
  const slots = Array.from({ length: count }, () => 0)
  for (const rule of rules) {
    if (rule.paused) continue
    const minutes = rule.duration_min ?? defaultMinutes
    // Occurrences starting just before the window can still overlap it.
    const from = new Date(start.getTime() - minutes * 60_000)
    for (const at of occurrences(rule, from, end)) {
      const s = Math.max(0, Math.floor((at.getTime() - start.getTime()) / slotMs))
      const e = Math.min(count, Math.ceil((at.getTime() + minutes * 60_000 - start.getTime()) / slotMs))
      for (let i = s; i < e; i++) slots[i]! += 1
    }
  }
  return { start, end, slotMinutes, slots }
}

export function coveragePercent(slots: number[]): number {
  if (slots.length === 0) return 0
  const covered = slots.filter(n => n > 0).length
  return Math.round((covered / slots.length) * 1000) / 10
}

export interface CoverageDay {
  date: string
  percent: number
  slots: number[]
}

// Coverage per calendar day in the campaign's timezone, with the per-slot
// counts the day view shows.
export function coverageByDay(grid: CoverageGrid, startDate: string, endDate: string, tz: string): CoverageDay[] {
  const days: CoverageDay[] = []
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const dayStart = zonedInstant(date, '00:00', tz)
    const dayEnd = zonedInstant(addDays(date, 1), '00:00', tz)
    const slotMs = grid.slotMinutes * 60_000
    const s = Math.round((dayStart.getTime() - grid.start.getTime()) / slotMs)
    const e = Math.round((dayEnd.getTime() - grid.start.getTime()) / slotMs)
    const slots = grid.slots.slice(Math.max(0, s), Math.max(0, e))
    days.push({ date, percent: coveragePercent(slots), slots })
  }
  return days
}

// The slot counts as the public calendar serves them.
export interface SlotCounts {
  start: Date | string
  slotMinutes: number
  slots: number[]
}

// The grid as the coverage screens fetch it: every slot's count in `slots`,
// and for each day the range of indexes (`from` up to `to`) that is its slots.
export interface CoverageCalendar {
  start: string
  slotMinutes: number
  timezone: string
  days: { date: string, percent: number, from: number, to: number }[]
  slots: number[]
}

export function coverageCalendar(grid: CoverageGrid, startDate: string, endDate: string, tz: string): CoverageCalendar {
  let from = 0
  const days = coverageByDay(grid, startDate, endDate, tz).map((d) => {
    const day = { date: d.date, percent: d.percent, from, to: from + d.slots.length }
    from += d.slots.length
    return day
  })
  return { start: grid.start.toISOString(), slotMinutes: grid.slotMinutes, timezone: tz, days, slots: grid.slots }
}

export interface DaySlot {
  index: number
  at: Date
  count: number
  // The slot has already started.
  past: boolean
}

// The slots at indexes `from` up to `to`, each at its real instant.
export function slotsInRange(c: SlotCounts, from: number, to: number, now: Date = new Date()): DaySlot[] {
  const start = new Date(c.start).getTime()
  const slotMs = c.slotMinutes * 60_000
  const out: DaySlot[] = []
  for (let i = Math.max(0, from); i < Math.min(to, c.slots.length); i++) {
    const at = start + i * slotMs
    out.push({ index: i, at: new Date(at), count: c.slots[i] ?? 0, past: at < now.getTime() })
  }
  return out
}

export interface TimeOfDayCoverage {
  // Minute of the local day the slot starts at.
  minute: number
  // Coming slots at this time of day, and how many of them have someone.
  total: number
  covered: number
}

// Milliseconds a timezone is ahead of UTC at an instant, read from Intl.
function offsetReader(tz: string): (at: number) => number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  return (at) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(at)).map(x => [x.type, x.value]))
    const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
    return wall - Math.floor(at / 1000) * 1000
  }
}

// Consecutive slots grouped by the clock hour they start in, in `tz`. An hour
// the clocks repeat makes two groups; an hour they skip makes none.
export function slotsByClockHour(slots: DaySlot[], tz: string): DaySlot[][] {
  const offsetAt = offsetReader(tz)
  const groups: DaySlot[][] = []
  let last = ''
  for (const slot of slots) {
    const offset = offsetAt(slot.at.getTime())
    const key = `${Math.floor((slot.at.getTime() + offset) / 3_600_000)}/${offset}`
    if (key !== last) groups.push([])
    last = key
    groups[groups.length - 1]!.push(slot)
  }
  return groups
}

// The day a coverage screen opens on: today when the campaign includes it,
// otherwise the first day with an uncovered slot, otherwise the first day.
export function openingCoverageDay(days: { date: string, percent: number }[], today: string): string | null {
  const day = days.find(d => d.date === today) ?? days.find(d => d.percent < 100) ?? days[0]
  return day?.date ?? null
}

// Coming slots (starting at or after `from`) with their local minute of the
// day in `tz`, keeping only the given local weekdays (0 = Sunday; all when
// empty). Offsets are looked up once per 15 minutes of real time.
function comingSlots(c: SlotCounts, tz: string, from: Date, weekdays: number[]): { index: number, minute: number }[] {
  const start = new Date(c.start).getTime()
  const slotMs = c.slotMinutes * 60_000
  const first = Math.max(0, Math.ceil((from.getTime() - start) / slotMs))
  const offsetAt = offsetReader(tz)
  const offsets = new Map<number, number>()
  const out: { index: number, minute: number }[] = []
  for (let i = first; i < c.slots.length; i++) {
    const at = start + i * slotMs
    const bucket = Math.floor(at / 900_000)
    let offset = offsets.get(bucket)
    if (offset === undefined) {
      offset = offsetAt(at)
      offsets.set(bucket, offset)
    }
    const local = at + offset
    if (weekdays.length && !weekdays.includes(new Date(local).getUTCDay())) continue
    out.push({ index: i, minute: Math.floor((((local % 86_400_000) + 86_400_000) % 86_400_000) / 60_000) })
  }
  return out
}

// How covered each time of day is from now to the campaign's end, as a
// recurring commitment at that time would meet it.
export function coverageByTimeOfDay(c: SlotCounts, tz: string, from: Date, weekdays: number[] = []): TimeOfDayCoverage[] {
  const byMinute = new Map<number, TimeOfDayCoverage>()
  for (const s of comingSlots(c, tz, from, weekdays)) {
    let row = byMinute.get(s.minute)
    if (!row) {
      row = { minute: s.minute, total: 0, covered: 0 }
      byMinute.set(s.minute, row)
    }
    row.total++
    if ((c.slots[s.index] ?? 0) > 0) row.covered++
  }
  return [...byMinute.values()].sort((a, b) => a.minute - b.minute)
}

// For a recurring commitment starting at `minute` and lasting `minutes`: the
// coming occurrences, and how many of them still have a slot nobody covers.
export function openOccurrences(c: SlotCounts, tz: string, from: Date, minute: number, minutes: number, weekdays: number[] = []): { total: number, open: number } {
  const span = Math.max(1, Math.ceil(minutes / c.slotMinutes))
  let total = 0
  let open = 0
  for (const s of comingSlots(c, tz, from, weekdays)) {
    if (s.minute !== minute) continue
    total++
    const end = Math.min(c.slots.length, s.index + span)
    for (let i = s.index; i < end; i++) {
      if ((c.slots[i] ?? 0) === 0) {
        open++
        break
      }
    }
  }
  return { total, open }
}
