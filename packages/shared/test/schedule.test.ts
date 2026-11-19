import { describe, expect, it } from 'vitest'
import { entryDate, entryNumber, nextOccurrence, nextReminderUtc, occurrences, validateRule, type CommitmentRule } from '../src/schedule'
import { zonedInstant } from '../src/dates'

function rule(r: Partial<CommitmentRule>): CommitmentRule {
  return { kind: 'recurring', frequency: 'daily', days_of_week: [], time: '07:00', timezone: 'America/New_York', duration_min: null, dates: [], starts_on: '2026-01-01', ends_on: null, ...r }
}

function chain(r: CommitmentRule, after: Date, n: number): string[] {
  const out: string[] = []
  let at: Date | null = after
  for (let i = 0; i < n && at; i++) {
    at = nextOccurrence(r, at)
    if (at) out.push(at.toISOString())
  }
  return out
}

describe('daily rules', () => {
  it('keeps 07:00 local across the New York spring change', () => {
    expect(chain(rule({}), new Date('2026-03-06T13:00:00Z'), 4)).toEqual([
      '2026-03-07T12:00:00.000Z',
      '2026-03-08T11:00:00.000Z',
      '2026-03-09T11:00:00.000Z',
      '2026-03-10T11:00:00.000Z'
    ])
  })

  it('keeps 07:00 local across the New York autumn change', () => {
    expect(chain(rule({}), new Date('2026-10-31T12:00:00Z'), 2)).toEqual([
      '2026-11-01T12:00:00.000Z',
      '2026-11-02T12:00:00.000Z'
    ])
  })

  it('keeps 21:15 local across both London changes', () => {
    const r = rule({ time: '21:15', timezone: 'Europe/London' })
    expect(chain(r, new Date('2026-03-28T12:00:00Z'), 2)).toEqual(['2026-03-28T21:15:00.000Z', '2026-03-29T20:15:00.000Z'])
    expect(chain(r, new Date('2026-10-24T12:00:00Z'), 2)).toEqual(['2026-10-24T20:15:00.000Z', '2026-10-25T21:15:00.000Z'])
  })

  it('a time skipped by the spring jump happens right after it', () => {
    expect(chain(rule({ time: '02:30' }), new Date('2026-03-07T12:00:00Z'), 2)).toEqual([
      // 02:30 does not exist on 8 March in New York; it lands at 03:30 EDT.
      '2026-03-08T07:30:00.000Z',
      '2026-03-09T06:30:00.000Z'
    ])
    expect(zonedInstant('2026-03-29', '01:30', 'Europe/London').toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('a repeated autumn hour uses its first occurrence', () => {
    expect(zonedInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })

  it('starts on starts_on and stops after ends_on', () => {
    const r = rule({ starts_on: '2026-05-10', ends_on: '2026-05-11' })
    expect(chain(r, new Date('2026-01-01T00:00:00Z'), 5)).toEqual(['2026-05-10T11:00:00.000Z', '2026-05-11T11:00:00.000Z'])
    expect(nextOccurrence(r, new Date('2026-05-11T11:00:00Z'))).toBeNull()
  })

  it('the occurrence at exactly `after` is not returned again', () => {
    expect(nextOccurrence(rule({}), new Date('2026-03-08T11:00:00Z'))?.toISOString()).toBe('2026-03-09T11:00:00.000Z')
  })

  it('paused commitments have no reminder', () => {
    expect(nextReminderUtc(rule({ paused: true }), new Date('2026-03-01T00:00:00Z'))).toBeNull()
    expect(nextReminderUtc(rule({}), new Date('2026-03-01T00:00:00Z'))?.toISOString()).toBe('2026-03-01T12:00:00.000Z')
  })
})

describe('weekly rules', () => {
  it('next Monday / Wednesday 18:30 in London, across the spring change', () => {
    const r = rule({ frequency: 'weekly', days_of_week: [1, 3], time: '18:30', timezone: 'Europe/London' })
    // Friday 27 March 2026 → Monday 30 March (BST from 29 March).
    expect(chain(r, new Date('2026-03-27T12:00:00Z'), 3)).toEqual([
      '2026-03-30T17:30:00.000Z',
      '2026-04-01T17:30:00.000Z',
      '2026-04-06T17:30:00.000Z'
    ])
  })

  it('a Sunday-only rule finds the next Sunday from any day', () => {
    const r = rule({ frequency: 'weekly', days_of_week: [0], time: '09:00', timezone: 'America/New_York' })
    expect(nextOccurrence(r, new Date('2026-03-02T00:00:00Z'))?.toISOString()).toBe('2026-03-08T13:00:00.000Z')
    expect(nextOccurrence(r, new Date('2026-03-08T13:00:00Z'))?.toISOString()).toBe('2026-03-15T13:00:00.000Z')
  })

  it('respects ends_on', () => {
    const r = rule({ frequency: 'weekly', days_of_week: [0], ends_on: '2026-03-10' })
    expect(nextOccurrence(r, new Date('2026-03-08T12:00:00Z'))).toBeNull()
  })
})

describe('monthly rules', () => {
  it('falls on the 1st or the 15th of each month', () => {
    const r = rule({ frequency: 'monthly', day_of_month: 15, time: '08:00', timezone: 'Europe/London' })
    expect(chain(r, new Date('2026-01-20T00:00:00Z'), 3)).toEqual([
      '2026-02-15T08:00:00.000Z',
      '2026-03-15T08:00:00.000Z',
      '2026-04-15T07:00:00.000Z'
    ])
    expect(nextOccurrence(rule({ frequency: 'monthly', day_of_month: 1 }), new Date('2026-01-01T12:00:00Z'))?.toISOString()).toBe('2026-02-01T12:00:00.000Z')
  })

  it('falls on the first of a weekday, up to five weeks apart', () => {
    const r = rule({ frequency: 'monthly', days_of_week: [5], time: '19:00', timezone: 'America/New_York' })
    // First Fridays of 2026: January 2, February 6, March 6.
    expect(chain(r, new Date('2026-01-01T00:00:00Z'), 3)).toEqual([
      '2026-01-03T00:00:00.000Z',
      '2026-02-07T00:00:00.000Z',
      '2026-03-07T00:00:00.000Z'
    ])
  })

  it('occurs once a month within a window', () => {
    const r = rule({ frequency: 'monthly', days_of_week: [0], time: '09:00', timezone: 'UTC' })
    expect(occurrences(r, new Date('2026-03-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z')).map(d => d.toISOString().slice(0, 10)))
      .toEqual(['2026-03-01', '2026-04-05', '2026-05-03'])
  })

  it('validates the day', () => {
    expect(validateRule({ kind: 'recurring', frequency: 'monthly', day_of_month: 15, time: '07:00' })).toEqual([])
    expect(validateRule({ kind: 'recurring', frequency: 'monthly', day_of_month: null, days_of_week: [3], time: '07:00' })).toEqual([])
    expect(validateRule({ kind: 'recurring', frequency: 'monthly', day_of_month: 10, time: '07:00' })).toEqual(['day_of_month'])
    expect(validateRule({ kind: 'recurring', frequency: 'monthly', day_of_month: null, days_of_week: [1, 3], time: '07:00' })).toEqual(['day_of_month'])
    expect(validateRule({ kind: 'recurring', frequency: 'monthly', day_of_month: 1, days_of_week: [1], time: '07:00' })).toEqual(['day_of_month'])
  })
})

describe('date lists and ranges', () => {
  it('specific-date picks are instants', () => {
    const r = rule({ kind: 'dates', frequency: null, dates: ['2026-03-08T03:00:00Z', '2026-03-01T03:00:00Z'] })
    expect(nextOccurrence(r, new Date('2026-02-01T00:00:00Z'))?.toISOString()).toBe('2026-03-01T03:00:00.000Z')
    expect(nextOccurrence(r, new Date('2026-03-08T03:00:00Z'))).toBeNull()
  })

  it('occurrences within a window', () => {
    const got = occurrences(rule({ starts_on: '2026-03-01', ends_on: '2026-03-10' }), new Date('2026-03-07T00:00:00Z'), new Date('2026-03-20T00:00:00Z'))
    expect(got.map(d => d.toISOString())).toEqual([
      '2026-03-07T12:00:00.000Z', '2026-03-08T11:00:00.000Z', '2026-03-09T11:00:00.000Z', '2026-03-10T11:00:00.000Z'
    ])
  })
})

describe('entries', () => {
  it('numbers entries from the anchor', () => {
    expect(entryNumber('2026-03-01', 'daily', '2026-03-01')).toBe(1)
    expect(entryNumber('2026-03-01', 'daily', '2026-03-08')).toBe(8)
    expect(entryNumber('2026-03-01', 'daily', '2026-02-28')).toBe(0)
    expect(entryNumber('2026-03-01', 'weekly', '2026-03-07')).toBe(1)
    expect(entryNumber('2026-03-01', 'weekly', '2026-03-08')).toBe(2)
    expect(entryDate('2026-03-01', 'weekly', 3)).toBe('2026-03-15')
    expect(entryDate('2026-03-01', 'daily', 31)).toBe('2026-03-31')
  })

  it('numbers monthly entries by calendar month', () => {
    expect(entryNumber('2026-01-01', 'monthly', '2026-01-31')).toBe(1)
    expect(entryNumber('2026-01-01', 'monthly', '2026-02-01')).toBe(2)
    expect(entryNumber('2026-01-01', 'monthly', '2027-01-01')).toBe(13)
    expect(entryNumber('2026-01-31', 'monthly', '2026-02-28')).toBe(2)
    expect(entryNumber('2026-03-10', 'monthly', '2026-04-09')).toBe(1)
    expect(entryNumber('2026-03-10', 'monthly', '2026-04-10')).toBe(2)
    expect(entryNumber('2026-03-01', 'monthly', '2026-02-28')).toBe(0)
    expect(entryDate('2026-01-01', 'monthly', 12)).toBe('2026-12-01')
    expect(entryDate('2026-01-31', 'monthly', 2)).toBe('2026-02-28')
  })

  it('validates rules', () => {
    expect(validateRule({ kind: 'recurring', frequency: 'daily', time: '07:00' })).toEqual([])
    expect(validateRule({ kind: 'recurring', frequency: 'weekly', days_of_week: [], time: '7:00' })).toEqual(['days_of_week', 'time'])
    expect(validateRule({ kind: 'dates', dates: [], time: '07:00' })).toEqual(['dates'])
    expect(validateRule({ kind: 'recurring', frequency: 'daily', time: '07:00', duration_min: 0 })).toEqual(['duration_min'])
  })
})
