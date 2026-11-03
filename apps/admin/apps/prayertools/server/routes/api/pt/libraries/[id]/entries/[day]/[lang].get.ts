import { db } from '#core/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const id = getRouterParam(event, 'id')!
  const day = Number(getRouterParam(event, 'day'))
  const lang = getRouterParam(event, 'lang')!
  const lib = await db.selectFrom('pt_library').select(['owner_user_id', 'visibility']).where('id', '=', id).executeTakeFirst()
  if (!lib) ptNotFound('Library not found.')
  const role = await ptLibraryRole(id, lib.owner_user_id, user.userId)
  const own = role === 'owner' || role === 'editor' || (lib.owner_user_id === null && user.isAdmin)
  const entry = await db.selectFrom('pt_library_entry').select(['draft', 'published', 'published_version']).where('library_id', '=', id).where('day', '=', day).where('language', '=', lang).executeTakeFirst()
  if (!own) {
    if (!role && lib.visibility !== 'published' && !user.isAdmin) ptNotFound('Library not found.')
    return { published: entry?.published ?? null }
  }
  return entry ?? { draft: null, published: null, published_version: null }
})
