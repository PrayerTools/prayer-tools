// The owner asks for the library to be shared with everyone, confirming they
// have the rights to it. Prayer.Tools reviews it, seeing the license.
import { db } from '#core/server/utils/database'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { lib } = await ptEditableLibrary(event, id, { ownerOnly: true })
  const { rights_confirmed } = await ptBody<{ rights_confirmed?: boolean }>(event)
  if (rights_confirmed !== true) ptBadRequest('Confirm that you have the rights to share this content.')
  if (lib.published_version < 1) ptBadRequest('Publish the library before asking to share it.')
  await db.updateTable('pt_library').set({ share_status: 'requested', share_requested_at: new Date(), rights_confirmed: true, updated_at: new Date() }).where('id', '=', id).execute()
  return { ok: true }
})
