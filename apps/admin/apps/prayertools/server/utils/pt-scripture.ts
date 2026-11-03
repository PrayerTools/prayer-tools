// Verse text from bolls.life for a reference in a translation (default NIV).
// `chapters` caches fetched chapters across several lookups in one request.
import { formatScriptureRef, parseScriptureRef } from '@prayertools/shared/scripture'

type Chapter = { verse: number, text: string }[]

export function ptBibleTranslation(input: unknown): string {
  return String(input || 'NIV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'NIV'
}

export async function ptLookupScripture(ref: string, translation: string, chapters?: Map<string, Promise<Chapter | null>>): Promise<{ text: string, reference: string, translation: string }> {
  const parsed = parseScriptureRef(ref)
  if (!parsed) ptBadRequest('Write the reference like "John 3:16" or "Psalm 23".')
  const key = `${translation}/${parsed.book}/${parsed.chapter}`
  let chapter = chapters?.get(key)
  if (!chapter) {
    chapter = fetch(`https://bolls.life/get-text/${key}/`, { signal: AbortSignal.timeout(10_000) })
      .then(res => (res.ok ? res.json() as Promise<Chapter> : null))
      .catch(() => null)
    chapters?.set(key, chapter)
  }
  const verses = await chapter
  if (!verses) throw createError({ statusCode: 502, statusMessage: 'Scripture lookup is unavailable right now. You can paste the text instead.' })
  const picked = verses.filter(v => parsed.from === null || (v.verse >= parsed.from && v.verse <= (parsed.to ?? parsed.from)))
  if (!picked.length) ptNotFound('Those verses were not found in this translation.')
  const text = picked.map(v => v.text.replace(/<S>\d+<\/S>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).join(' ')
  return { text, reference: formatScriptureRef(parsed), translation }
}
