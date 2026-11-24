import { describe, expect, it } from 'vitest'
import { dailyPercents } from '../src/stats'
import type { CommitmentRule } from '../src/schedule'

const NY = 'America/New_York'

function daily(time: string, minutes: number | null, extra: Partial<CommitmentRule> = {}): CommitmentRule {
  return { kind: 'recurring', frequency: 'daily', days_of_week: [], time, timezone: NY, duration_min: minutes, dates: [], starts_on: '2026-01-01', ends_on: null, ...extra }
}

describe('daily goal percents', () => {
  it('gives each day of a 24/7 campaign its covered share, rounded down', () => {
    const c = { goal: 'coverage' as const, goal_target: null, timezone: NY }
    // 6 hours of 24 every day, and one extra hour only on the second day.
    const rules = [daily('00:00', 360), daily('12:00', 60, { starts_on: '2026-03-02', ends_on: '2026-03-02' })]
    expect(dailyPercents(c, rules, '2026-03-01', '2026-03-03')).toEqual([25, 29, 25])
  })

  it('counts the minutes committed on each day against the daily prayer-time target', () => {
    const c = { goal: 'prayer_time' as const, goal_target: 120, timezone: NY }
    const rules = [
      daily('07:00', 30),
      daily('08:00', 30),
      daily('21:00', null),
      daily('09:00', 60, { paused: true }),
      { ...daily('10:00', 90), kind: 'dates' as const, frequency: null, dates: ['2026-03-02T15:00:00Z'] }
    ]
    // 30 + 30 + 15 (default length) = 75 of 120 minutes; the second day adds a 90-minute one-off.
    expect(dailyPercents(c, rules, '2026-03-01', '2026-03-03')).toEqual([62, 100, 62])
  })

  it('counts a prayer time in the campaign\'s timezone on the day it falls there', () => {
    const c = { goal: 'prayer_time' as const, goal_target: 60, timezone: NY }
    // 23:30 in London is 18:30 or 19:30 in New York: always the same New York day.
    expect(dailyPercents(c, [daily('23:30', 30, { timezone: 'Europe/London' })], '2026-03-01', '2026-03-02')).toEqual([50, 50])
  })
})
