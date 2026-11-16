// Library editions: yearly libraries share a series under one owner, and the
// edition names the year (or other run) each one was made for.

export interface LibraryEdition {
  id: string
  owner_user_id: string | null
  series: string | null
  edition: string | null
}

// Names a library's series within its owner's libraries (the platform's when
// it has no owner); null for a library outside any series.
export function seriesKey(lib: Pick<LibraryEdition, 'owner_user_id' | 'series'>): string | null {
  return lib.series ? `${lib.owner_user_id ?? 'platform'}:${lib.series.toLowerCase()}` : null
}

// Sorts newest edition first: numbers by value ("10" is newer than "9"),
// other text alphabetically, and a library without an edition last.
export function newestEditionFirst(a: Pick<LibraryEdition, 'edition'>, b: Pick<LibraryEdition, 'edition'>): number {
  return (b.edition ?? '').localeCompare(a.edition ?? '', 'en', { numeric: true })
}

// The editions of `current`'s series in `candidates` that are newer than it, newest first.
export function newerEditions<T extends LibraryEdition>(current: LibraryEdition, candidates: T[]): T[] {
  const key = seriesKey(current)
  if (!key) return []
  return candidates
    .filter(c => c.id !== current.id && seriesKey(c) === key && newestEditionFirst(c, current) < 0)
    .sort(newestEditionFirst)
}
