import { describe, expect, it } from 'vitest'
import { newerEditions, newestEditionFirst, seriesKey, type LibraryEdition } from '../src/editions'

function lib(id: string, edition: string | null, series: string | null = 'Ramadan Guide', owner: string | null = null): LibraryEdition {
  return { id, owner_user_id: owner, series, edition }
}

describe('library editions', () => {
  it('keys a series by its owner, ignoring case', () => {
    expect(seriesKey(lib('a', '2026'))).toBe('platform:ramadan guide')
    expect(seriesKey(lib('a', '2026', 'RAMADAN guide'))).toBe('platform:ramadan guide')
    expect(seriesKey(lib('a', '2026', 'Ramadan Guide', 'u1'))).toBe('u1:ramadan guide')
    expect(seriesKey(lib('a', '2026', null))).toBeNull()
  })

  it('sorts numeric editions by value, newest first', () => {
    const sorted = [lib('a', '2026'), lib('b', '2027'), lib('c', '2025')].sort(newestEditionFirst)
    expect(sorted.map(l => l.edition)).toEqual(['2027', '2026', '2025'])
    expect([lib('a', '9'), lib('b', '10')].sort(newestEditionFirst).map(l => l.edition)).toEqual(['10', '9'])
  })

  it('finds the newer editions of a numeric series, newest first', () => {
    const editions = [lib('a', '2025'), lib('b', '2026'), lib('c', '2027'), lib('d', '2028')]
    expect(newerEditions(lib('b', '2026'), editions).map(l => l.id)).toEqual(['d', 'c'])
  })

  it('sorts non-numeric editions alphabetically', () => {
    const editions = [lib('a', 'Autumn'), lib('b', 'Spring'), lib('c', 'Winter')]
    expect(newerEditions(lib('b', 'Spring'), editions).map(l => l.id)).toEqual(['c'])
    expect(newerEditions(lib('a', 'Autumn'), editions).map(l => l.id)).toEqual(['c', 'b'])
  })

  it('compares the numbers inside mixed editions', () => {
    expect(newerEditions(lib('a', 'v9'), [lib('b', 'v10'), lib('c', 'v2')]).map(l => l.id)).toEqual(['b'])
  })

  it('treats a missing edition as the oldest', () => {
    const editions = [lib('a', null), lib('b', '2026')]
    expect(newerEditions(lib('a', null), editions).map(l => l.id)).toEqual(['b'])
    expect(newerEditions(lib('b', '2026'), editions)).toEqual([])
    expect(newerEditions(lib('a', null), [lib('c', null)])).toEqual([])
  })

  it('ignores other series', () => {
    expect(newerEditions(lib('a', '2026'), [lib('b', '2027', 'Lent Guide')])).toEqual([])
    expect(newerEditions(lib('a', '2026'), [lib('b', '2027', null)])).toEqual([])
  })

  it('has nothing newer for a library outside any series', () => {
    expect(newerEditions(lib('a', '2026', null), [lib('b', '2027', null), lib('c', '2027')])).toEqual([])
  })

  it('keeps each owner\'s series apart', () => {
    const editions = [lib('b', '2027', 'Ramadan Guide', 'u1'), lib('c', '2027', 'Ramadan Guide', 'u2')]
    expect(newerEditions(lib('a', '2026'), editions)).toEqual([])
    expect(newerEditions(lib('a', '2026', 'Ramadan Guide', 'u1'), editions).map(l => l.id)).toEqual(['b'])
    expect(newerEditions(lib('a', '2026', 'ramadan guide', 'u2'), [...editions, lib('d', '2028')]).map(l => l.id)).toEqual(['c'])
  })

  it('finds nothing when the library is the newest', () => {
    const editions = [lib('a', '2025'), lib('b', '2026'), lib('c', '2027')]
    expect(newerEditions(lib('c', '2027'), editions)).toEqual([])
  })

  it('never counts the library itself or an equal edition', () => {
    expect(newerEditions(lib('a', '2026'), [lib('a', '2027'), lib('b', '2026')])).toEqual([])
  })
})
