// Downloads a library as a content pack (pack.json) that the operator import
// reads back. Editors get the drafts; everyone else who can read the library
// gets the published text. Images stay as their hosted URLs.
import { db } from '#core/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const id = getRouterParam(event, 'id')!
  const lib = await db.selectFrom('pt_library').selectAll().where('id', '=', id).executeTakeFirst()
  if (!lib) ptNotFound('Library not found.')
  const role = await ptLibraryRole(lib.id, lib.owner_user_id, user.userId)
  const own = role === 'owner' || role === 'editor' || (lib.owner_user_id === null && user.isAdmin)
  if (!own && !role && lib.visibility !== 'published' && !user.isAdmin) ptNotFound('Library not found.')
  const rows = await db.selectFrom('pt_library_entry').select(['day', 'language', 'draft', 'published'])
    .where('library_id', '=', id).orderBy('day').orderBy('language').execute()
  const entries = rows.map(r => ({ day: r.day, language: r.language, doc: own ? r.draft : r.published })).filter(e => e.doc)
  const pack = {
    title: lib.title,
    description: lib.description,
    cadence: lib.cadence,
    source_language: lib.source_language,
    license: lib.license,
    license_note: lib.license_note,
    credit: lib.credit,
    topics: lib.topics,
    template_keys: lib.template_keys,
    entries
  }
  const name = lib.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'library'
  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${name}.json"`)
  return JSON.stringify(pack, null, 2)
})
