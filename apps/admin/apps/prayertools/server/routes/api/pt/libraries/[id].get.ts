// A library with its entry grid (day × language): whether each draft differs
// from the published text, and for its editors, how many sites use it. Readable by its owner, operators, and everyone once
// published; and by the people it is shared with, whose role says whether they edit it.
import { db } from '#core/server/utils/database'
import { sql } from 'kysely'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const id = getRouterParam(event, 'id')!
  const lib = await db.selectFrom('pt_library').selectAll().where('id', '=', id).executeTakeFirst()
  if (!lib) ptNotFound('Library not found.')
  const role = await ptLibraryRole(lib.id, lib.owner_user_id, user.userId)
  const own = role === 'owner' || role === 'editor' || (lib.owner_user_id === null && user.isAdmin)
  if (!own && !role && lib.visibility !== 'published' && !user.isAdmin) ptNotFound('Library not found.')
  const entries = await db.selectFrom('pt_library_entry')
    .select(['day', 'language', 'published_version', sql<boolean>`published IS NULL OR draft <> published`.as('unpublished')])
    .where('library_id', '=', id).orderBy('day').orderBy('language').execute()
  const owner = lib.owner_user_id ? await db.selectFrom('users').select(['display_name']).where('id', '=', lib.owner_user_id).executeTakeFirst() : null
  const usage = own ? await ptLibraryUsage(id) : null
  return { library: { ...lib, owner_name: owner?.display_name ?? 'Prayer.Tools' }, entries, canEdit: own, role, usage }
})
