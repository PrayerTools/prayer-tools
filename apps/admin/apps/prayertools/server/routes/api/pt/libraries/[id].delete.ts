// Deletes a library no site follows. Sites that edited their copy keep it as
// their own content. Owners can delete their libraries until they are shared;
// operators can delete platform libraries.
import { db } from '#core/server/utils/database'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { lib } = await ptEditableLibrary(event, id, { ownerOnly: true })
  const { following } = await ptLibraryUsage(id)
  if (lib.visibility === 'published' && lib.owner_user_id) ptBadRequest('Shared libraries can\'t be deleted; ask Prayer.Tools to withdraw it.')
  if (following > 0) ptBadRequest(`${following} ${following === 1 ? 'site follows' : 'sites follow'} this library; their prayer content would disappear. Remove it from those campaigns first.`)
  await db.deleteFrom('pt_library').where('id', '=', id).execute()
  return { ok: true }
})
