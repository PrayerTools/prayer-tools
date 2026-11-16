import { db } from '#core/server/utils/database'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { lib } = await ptEditableLibrary(event, id)
  const b = await ptBody(event)
  const meta = ptLibraryMeta(b, true)
  // Only platform libraries have keys, and only operators reach them here.
  if ('key' in b && lib.owner_user_id === null) {
    const key = ptLibraryKey(b.key)
    const taken = key ? await db.selectFrom('pt_library').select('title').where('key', '=', key).where('id', '<>', id).executeTakeFirst() : undefined
    if (taken) ptBadRequest(`The key "${key}" belongs to “${taken.title}”.`)
    meta.key = key
  }
  if (Object.keys(meta).length) await db.updateTable('pt_library').set({ ...meta, updated_at: new Date() } as never).where('id', '=', id).execute()
  return { ok: true }
})
