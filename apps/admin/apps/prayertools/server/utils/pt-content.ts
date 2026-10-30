import { sql, type Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import { jsonb } from '@prayertools/shared/db/json'

type Tx = Transaction<Database>

export async function ptSiteLibrary(tx: Tx, id: string) {
  const sl = await tx.selectFrom('pt_site_library').selectAll().where('id', '=', id).executeTakeFirst()
  if (!sl) ptNotFound('Library not found on this site.')
  return sl
}

// The first edit of a followed library gives the site its own copy, frozen
// at the version it was on. From then on library updates never change it.
export async function ptFreezeCopy(tx: Tx, siteLibraryId: string): Promise<void> {
  const sl = await ptSiteLibrary(tx, siteLibraryId)
  if (!sl.library_id || sl.frozen_version !== null) return
  const lib = await tx.selectFrom('pt_library').select(['published_version']).where('id', '=', sl.library_id).executeTakeFirst()
  const entries = await tx.selectFrom('pt_library_entry').select(['day', 'language', 'published']).where('library_id', '=', sl.library_id).where('published', 'is not', null).execute()
  for (const e of entries) {
    await tx.insertInto('pt_site_entry').values({ site_library_id: siteLibraryId, day: e.day, language: e.language, content: jsonb(e.published), edited: false } as never)
      .onConflict(oc => oc.columns(['site_library_id', 'day', 'language']).doNothing()).execute()
  }
  await tx.updateTable('pt_site_library').set({ frozen_version: lib?.published_version ?? 0 }).where('id', '=', siteLibraryId).execute()
}

// Replaces the site's copy with the library's latest published version,
// discarding the site's edits to that library.
export async function ptTakeLibraryUpdate(tx: Tx, siteLibraryId: string): Promise<void> {
  const sl = await ptSiteLibrary(tx, siteLibraryId)
  if (!sl.library_id) ptBadRequest('This content was written for the site; there is no library to update from.')
  await tx.deleteFrom('pt_site_entry').where('site_library_id', '=', siteLibraryId).execute()
  await tx.updateTable('pt_site_library').set({ frozen_version: null }).where('id', '=', siteLibraryId).execute()
}

export async function ptLibraryReadable(tx: Tx, libraryId: string, userId: string) {
  const lib = await tx.selectFrom('pt_library').selectAll().where('id', '=', libraryId).executeTakeFirst()
  if (!lib) ptNotFound('Library not found.')
  if (lib.visibility !== 'published' && lib.owner_user_id !== userId) ptNotFound('Library not found.')
  return lib
}

// Whether a campaign's content says {in_place} or {of_place} anywhere; with `name`, {place} too.
export async function ptCampaignUsesPlacePhrases(tx: Tx, campaignId: string, { name = false } = {}): Promise<boolean> {
  const pattern = name ? '\\{((in|of)_)?place\\}' : '\\{(in|of)_place\\}'
  const libs = await tx.selectFrom('pt_campaign_library as cl').innerJoin('pt_site_library as sl', 'sl.id', 'cl.site_library_id')
    .select(['sl.id', 'sl.library_id', 'sl.frozen_version']).where('cl.campaign_id', '=', campaignId).execute()
  const followed = libs.filter(l => l.library_id && l.frozen_version === null).map(l => l.library_id!)
  const own = libs.filter(l => !l.library_id || l.frozen_version !== null).map(l => l.id)
  if (followed.length) {
    const hit = await tx.selectFrom('pt_library_entry').select('id').where('library_id', 'in', followed)
      .where(sql<boolean>`published::text ~ ${pattern}`).limit(1).executeTakeFirst()
    if (hit) return true
  }
  if (own.length) {
    const hit = await tx.selectFrom('pt_site_entry').select('id').where('site_library_id', 'in', own)
      .where(sql<boolean>`content::text ~ ${pattern}`).limit(1).executeTakeFirst()
    if (hit) return true
  }
  return false
}

// A campaign's stacked libraries with entry counts, language coverage, and
// the days each language has an entry (and is out of date) for.
export async function ptCampaignLibraries(tx: Tx, campaignId: string, languages: string[]) {
  const rows = await tx
    .selectFrom('pt_campaign_library as cl')
    .innerJoin('pt_site_library as sl', 'sl.id', 'cl.site_library_id')
    .leftJoin('pt_library as l', 'l.id', 'sl.library_id')
    .select([
      'cl.position', 'sl.id', 'sl.title', 'sl.cadence', 'sl.library_id', 'sl.frozen_version',
      'l.title as library_title', 'l.published_version', 'l.credit', 'l.license', 'l.entry_count', 'l.languages as library_languages', 'l.owner_user_id'
    ])
    .where('cl.campaign_id', '=', campaignId)
    .orderBy('cl.position')
    .execute()
  const libraries = []
  for (const r of rows) {
    const follows = !!r.library_id && r.frozen_version === null
    const entries = follows
      ? (await tx.selectFrom('pt_library_entry').select(['day', 'language'])
          .where('library_id', '=', r.library_id!).where('published', 'is not', null).execute()).map(e => ({ ...e, stale: false }))
      : await tx.selectFrom('pt_site_entry').select(['day', 'language', 'stale']).where('site_library_id', '=', r.id).execute()
    const entryDays: Record<string, number[]> = {}
    const staleDays: Record<string, number[]> = {}
    for (const e of entries) {
      ;(entryDays[e.language] ??= []).push(e.day)
      if (e.stale) (staleDays[e.language] ??= []).push(e.day)
    }
    const coverage = Object.fromEntries(Object.entries(entryDays).map(([lang, days]) => [lang, days.length]))
    const entryCount = follows ? Number(r.entry_count ?? 0) : Math.max(0, ...entries.map(e => e.day))
    libraries.push({
      siteLibraryId: r.id,
      title: r.title,
      cadence: r.cadence,
      libraryId: r.library_id,
      follows,
      frozenVersion: r.frozen_version,
      latestVersion: r.published_version ?? null,
      updateAvailable: !!r.library_id && r.frozen_version !== null && (r.published_version ?? 0) > r.frozen_version,
      credit: r.credit,
      license: r.license,
      entryCount,
      coverage,
      entryDays,
      staleDays,
      missingLanguages: languages.filter(l => (coverage[l] ?? 0) < entryCount),
      staleCount: entries.filter(e => e.stale).length
    })
  }
  return libraries
}
