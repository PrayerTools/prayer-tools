import { describe, expect, test } from 'bun:test'
import { isUuid, parseAnswers, parseRuleInput } from '../server/lib/input'

describe('parseRuleInput', () => {
  test('daily rule keeps time and drops days', () => {
    expect(parseRuleInput({ frequency: 'daily', days_of_week: [1, 2], time: '07:30', duration_min: 15 })).toEqual({
      kind: 'recurring', time: '07:30', frequency: 'daily', days_of_week: [1, 2], duration_min: 15
    })
  })

  test('weekly rule filters invalid weekdays and duplicates', () => {
    const r = parseRuleInput({ frequency: 'weekly', days_of_week: [1, 1, 9, -1, '3', 2.5], time: '21:00' })
    expect(r?.days_of_week).toEqual([1, 3])
    expect(r?.duration_min).toBeNull()
  })

  test('monthly rule keeps its day of the month or its weekday', () => {
    expect(parseRuleInput({ frequency: 'monthly', day_of_month: 15, days_of_week: [], time: '08:00' })).toMatchObject({ frequency: 'monthly', day_of_month: 15, days_of_week: [] })
    expect(parseRuleInput({ frequency: 'monthly', day_of_month: null, days_of_week: [5], time: '08:00' })).toMatchObject({ frequency: 'monthly', day_of_month: null, days_of_week: [5] })
    expect(Number.isNaN(parseRuleInput({ frequency: 'monthly', day_of_month: 'x', time: '08:00' })!.day_of_month)).toBe(true)
    expect(parseRuleInput({ frequency: 'daily', day_of_month: 15, time: '08:00' })?.day_of_month).toBeUndefined()
  })

  test('dates rule normalizes instants and drops junk', () => {
    const r = parseRuleInput({ kind: 'dates', dates: ['2026-10-01T03:00:00+03:00', 'nope', 5], time: '03:00' })
    expect(r?.dates).toEqual(['2026-10-01T00:00:00.000Z'])
    expect(r?.frequency).toBeUndefined()
  })

  test('non-integer duration becomes NaN so validation rejects it', () => {
    expect(Number.isNaN(parseRuleInput({ time: '07:00', duration_min: 'abc' })!.duration_min)).toBe(true)
  })

  test('non-object input is rejected', () => {
    expect(parseRuleInput(null)).toBeNull()
    expect(parseRuleInput('daily')).toBeNull()
  })
})

describe('parseAnswers', () => {
  const fields = [
    { key: 'church', kind: 'text' as const, required: true, options: [] },
    { key: 'region', kind: 'select' as const, required: false, options: [{ key: 'north' }, { key: 'south' }] },
    { key: 'pastor', kind: 'checkbox' as const, required: false, options: [] }
  ]

  test('stores answers under pt_<key>', () => {
    expect(parseAnswers(fields, { church: '  Grace  ', region: 'north', pastor: true })).toEqual({
      answers: { pt_church: 'Grace', pt_region: 'north', pt_pastor: true },
      missing: []
    })
  })

  test('rejects unknown select options and reports missing required fields', () => {
    expect(parseAnswers(fields, { region: 'east' })).toEqual({ answers: { pt_pastor: false }, missing: ['church'] })
  })
})

test('isUuid', () => {
  expect(isUuid('0d53c1b8-ba27-40f4-8eab-5d0222294306')).toBe(true)
  expect(isUuid('0d53c1b8')).toBe(false)
  expect(isUuid(42)).toBe(false)
})
