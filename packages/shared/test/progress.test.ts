import { describe, expect, it } from 'vitest'
import { positionOf } from '../src/progress'

const NY = 'America/New_York'
const at = new Date('2026-03-20T15:00:00Z')

describe('personal-start position', () => {
  it('is on the entry after the ones they have opened', () => {
    expect(positionOf({ entries_done: 0, advanced_on: null, timezone: NY }, 'daily', 30, at)).toEqual({ current: 1, movedToday: false, entries: 30, finished: false })
    expect(positionOf({ entries_done: 4, advanced_on: '2026-03-19', timezone: NY }, 'daily', 30, at)).toMatchObject({ current: 5, movedToday: false })
  })

  it('moves forward once per day, or once per week for weekly campaigns, in the person\'s timezone', () => {
    expect(positionOf({ entries_done: 4, advanced_on: '2026-03-20', timezone: NY }, 'daily', 30, at).movedToday).toBe(true)
    expect(positionOf({ entries_done: 4, advanced_on: '2026-03-20', timezone: 'Asia/Tokyo' }, 'daily', 30, new Date('2026-03-20T16:00:00Z')).movedToday).toBe(false)
    expect(positionOf({ entries_done: 2, advanced_on: '2026-03-14', timezone: NY }, 'weekly', 10, at).movedToday).toBe(true)
    expect(positionOf({ entries_done: 2, advanced_on: '2026-03-13', timezone: NY }, 'weekly', 10, at).movedToday).toBe(false)
  })

  it('moves forward once per calendar month for monthly campaigns', () => {
    expect(positionOf({ entries_done: 2, advanced_on: '2026-03-01', timezone: NY }, 'monthly', 12, at).movedToday).toBe(true)
    expect(positionOf({ entries_done: 2, advanced_on: '2026-02-28', timezone: NY }, 'monthly', 12, at).movedToday).toBe(false)
  })

  it('is finished past the last entry; never without a known length', () => {
    expect(positionOf({ entries_done: 30, advanced_on: '2026-03-19', timezone: NY }, 'daily', 30, at)).toMatchObject({ current: 31, finished: true })
    expect(positionOf({ entries_done: 30, advanced_on: '2026-03-19', timezone: NY }, 'daily', null, at).finished).toBe(false)
  })
})
