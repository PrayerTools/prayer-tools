// Libraries are global: owned by a champion's account (usable on all their
// sites and by the people they share it with, private until shared with
// everyone) or by the platform (owner null, curated by operators). Sites follow a library's latest published version until they
// edit it.
import type { H3Event } from 'h3'
import { sql } from 'kysely'
import { db } from '#core/server/utils/database'
import { requireAuth } from '#core/server/utils/auth'
import { LICENSES } from '@prayertools/shared/content'
import { isLanguage } from '@prayertools/shared/languages'
import { pgArray } from '@prayertools/shared/db/json'

export async function ptUser(event: H3Event): Promise<{ userId: string, isAdmin: boolean }> {
  const auth = requireAuth(event)
  const row = await db.selectFrom('users').select('is_admin').where('id', '=', auth.userId).executeTakeFirst()
  return { userId: auth.userId, isAdmin: !!row?.is_admin }
}

// How many sites follow a library (render its published entries) and how many
// have edited their own copy, across every site.
export async function ptLibraryUsage(libraryId: string): Promise<{ following: number, copies: number }> {
  const rows = await ptAdminDb().selectFrom('pt_site_library').select(sql<boolean>`frozen_version IS NULL`.as('follows'))
    .where('library_id', '=', libraryId).execute()
  const following = rows.filter(r => r.follows).length
  return { following, copies: rows.length - following }
}

// A library the caller may edit: their own, one shared with them as an editor
// (unless `ownerOnly`), or for operators a platform library.
export async function ptEditableLibrary(event: H3Event, id: string, { ownerOnly = false } = {}) {
  const user = await ptUser(event)
  const lib = await db.selectFrom('pt_library').selectAll().where('id', '=', id).executeTakeFirst()
  if (!lib) ptNotFound('Library not found.')
  const platform = lib.owner_user_id === null && user.isAdmin
  const role = await ptLibraryRole(lib.id, lib.owner_user_id, user.userId)
  if (!platform && role !== 'owner' && (ownerOnly || role !== 'editor')) {
    throw createError({ statusCode: 403, statusMessage: ownerOnly ? 'Only the library\'s owner can do this.' : 'Only the library\'s owner and editors can edit it.' })
  }
  return { lib, user }
}

export function ptLibraryMeta(b: Record<string, unknown>, partial = false) {
  const out: Record<string, unknown> = {}
  if (!partial || 'title' in b) {
    const title = String(b.title ?? '').trim()
    if (title.length < 2 || title.length > 120) ptBadRequest('Title must be 2–120 characters.')
    out.title = title
  }
  if ('description' in b) out.description = typeof b.description === 'string' ? b.description.slice(0, 2000) : null
  if (!partial || 'cadence' in b) out.cadence = b.cadence === 'weekly' ? 'weekly' : 'daily'
  if (!partial || 'source_language' in b) {
    if (!isLanguage(b.source_language)) ptBadRequest('Unknown source language.')
    out.source_language = b.source_language
  }
  if (!partial || 'license' in b) {
    if (!(LICENSES as readonly string[]).includes(String(b.license))) ptBadRequest('Choose a license.')
    out.license = b.license
  }
  if ('license_note' in b) out.license_note = typeof b.license_note === 'string' ? b.license_note.slice(0, 500) : null
  if ('credit' in b) out.credit = typeof b.credit === 'string' ? b.credit.slice(0, 200) : null
  if ('topics' in b) out.topics = pgArray((Array.isArray(b.topics) ? b.topics : []).map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 12))
  if ('template_keys' in b) out.template_keys = pgArray((Array.isArray(b.template_keys) ? b.template_keys : []).map(String).slice(0, 10))
  return out
}

// Publishes every draft: the drafts become the published text and the version
// number moves on, so sites following the library get the new text.
export async function ptPublishLibrary(libraryId: string): Promise<number> {
  return await db.transaction().execute(async (tx) => {
    const lib = await tx.selectFrom('pt_library').select('published_version').where('id', '=', libraryId).forUpdate().executeTakeFirstOrThrow()
    const version = lib.published_version + 1
    await tx.updateTable('pt_library_entry').set({ published: sql`draft`, published_version: version }).where('library_id', '=', libraryId).execute()
    const stats = await tx.selectFrom('pt_library_entry').select([eb => eb.fn.max('day').as('max')]).where('library_id', '=', libraryId).executeTakeFirst()
    const langs = await tx.selectFrom('pt_library_entry').select('language').distinct().where('library_id', '=', libraryId).execute()
    await tx.updateTable('pt_library').set({
      published_version: version,
      published_at: new Date(),
      entry_count: Number(stats?.max ?? 0),
      languages: pgArray(langs.map(l => l.language)),
      updated_at: new Date()
    }).where('id', '=', libraryId).execute()
    return version
  })
}
