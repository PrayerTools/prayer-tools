import { describe, expect, test } from 'bun:test'
import { zonedInstant } from '@prayertools/shared/dates'
import { pickedPlan, ruleRuns, toMonthly, type TimeRow } from './times'

const TZ = 'America/Chicago'
const at = (day: string, time: string, minutes = 15): TimeRow => {
  const begin = Math.floor(zonedInstant(day, time, TZ).getTime() / 1000)
  return { begin, end: begin + minutes * 60 }
}
const days = (from: string, n: number, step = 1) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * step * 86_400_000).toISOString().slice(0, 10))

describe('ruleRuns', () => {
  test('a rule whose rows match it is one rule', () => {
    const runs = ruleRuns(days('2026-03-01', 30).map(d => at(d, '06:00')), TZ, 'daily', true)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ frequency: 'daily', time: '06:00', startsOn: '2026-03-01', endsOn: '2026-03-30', minutes: 15, open: true })
  })

  test('keeps local time across a DST change', () => {
    const runs = ruleRuns(days('2026-03-01', 14).map(d => at(d, '06:00')), TZ, 'daily', true)
    expect(runs).toHaveLength(1)
  })

  test('a time change splits the rule where it happened', () => {
    const rows = [...days('2026-03-01', 10).map(d => at(d, '06:00')), ...days('2026-03-11', 5).map(d => at(d, '19:30'))]
    const runs = ruleRuns(rows, TZ, 'daily', true)
    expect(runs.map(r => [r.time, r.startsOn, r.endsOn, r.open])).toEqual([['06:00', '2026-03-01', '2026-03-10', false], ['19:30', '2026-03-11', '2026-03-15', true]])
  })

  test('a removed day splits the rule around it', () => {
    const rows = days('2026-03-01', 10).filter(d => d !== '2026-03-05').map(d => at(d, '06:00'))
    expect(ruleRuns(rows, TZ, 'daily', true).map(r => [r.startsOn, r.endsOn])).toEqual([['2026-03-01', '2026-03-04'], ['2026-03-06', '2026-03-10']])
  })

  test('a deleted weekly rule is read from its spacing and stays closed', () => {
    const runs = ruleRuns(days('2026-03-02', 4, 7).map(d => at(d, '08:00', 30)), TZ, null, false)
    expect(runs).toEqual([expect.objectContaining({ frequency: 'weekly', days: [1], startsOn: '2026-03-02', endsOn: '2026-03-23', minutes: 30, open: false })])
  })
})

describe('pickedPlan', () => {
  test('days in a row at one time become a daily rule', () => {
    const plan = pickedPlan(days('2026-03-01', 7).map(d => at(d, '05:15')), new Set(), TZ)
    expect(plan.rules).toEqual([expect.objectContaining({ frequency: 'daily', time: '05:15', startsOn: '2026-03-01', endsOn: '2026-03-07' })])
    expect(plan.dates).toBeNull()
  })

  test('two times a day become two daily rules', () => {
    const rows = days('2026-03-01', 5).flatMap(d => [at(d, '06:00'), at(d, '18:00')])
    expect(pickedPlan(rows, new Set(), TZ).rules.map(r => r.time).sort()).toEqual(['06:00', '18:00'])
  })

  test('the same weekdays every week merge into one weekly rule', () => {
    const rows = [...days('2026-03-02', 3, 7), ...days('2026-03-04', 3, 7)].map(d => at(d, '07:00'))
    const plan = pickedPlan(rows, new Set(), TZ)
    expect(plan.rules).toEqual([expect.objectContaining({ frequency: 'weekly', days: [1, 3], startsOn: '2026-03-02', endsOn: '2026-03-18' })])
  })

  test('weekday runs over different weeks stay separate', () => {
    const rows = [...days('2026-03-02', 2, 7), ...days('2026-03-18', 2, 7)].map(d => at(d, '07:00'))
    expect(pickedPlan(rows, new Set(), TZ).rules).toHaveLength(2)
  })

  test('scattered times stay a date list and times a rule holds are dropped', () => {
    const rule = at('2026-03-03', '06:00')
    const rows = [at('2026-03-01', '06:00'), rule, at('2026-03-09', '13:00')]
    const plan = pickedPlan(rows, new Set([rule.begin]), TZ)
    expect(plan.duplicates).toBe(1)
    expect(plan.rules).toEqual([])
    expect(plan.dates?.times).toHaveLength(2)
  })
})

describe('toMonthly', () => {
  const rule = (frequency: 'daily' | 'weekly', startsOn: string, endsOn: string, days: number[] = [], time = '07:00') =>
    ({ frequency, days, time, startsOn, endsOn, lastAt: new Date(`${endsOn}T12:00:00Z`), minutes: 15, open: false })

  test('weekly becomes the first of that weekday, daily the 1st', () => {
    expect(toMonthly([rule('weekly', '2026-01-05', '2026-03-30', [1])])).toEqual([expect.objectContaining({ frequency: 'monthly', days: [1], dayOfMonth: null })])
    expect(toMonthly([rule('daily', '2026-01-01', '2026-03-31')])).toEqual([expect.objectContaining({ frequency: 'monthly', days: [], dayOfMonth: 1 })])
  })

  test('runs that become the same monthly time merge over their dates', () => {
    const merged = toMonthly([rule('daily', '2026-01-01', '2026-01-10'), rule('daily', '2026-01-12', '2026-03-31'), rule('daily', '2026-02-01', '2026-02-02', [], '19:00')])
    expect(merged.map(r => [r.time, r.startsOn, r.endsOn])).toEqual([['07:00', '2026-01-01', '2026-03-31'], ['19:00', '2026-02-01', '2026-02-02']])
  })
})
