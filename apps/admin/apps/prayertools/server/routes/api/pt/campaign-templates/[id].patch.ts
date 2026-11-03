// Renames a campaign template; its owner or an editor.
import { withUserContext } from '#core/server/utils/personal-apps'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const id = getRouterParam(event, 'id')!
  const b = await ptBody(event)
  const name = String(b.name ?? '').trim()
  if (name.length < 2 || name.length > 120) ptBadRequest('Template name must be 2–120 characters.')
  const res = await withUserContext(event, { appId: PT_LIBRARY_APP }, tx => ptTx(tx).updateTable('pt_personal_template').set({ name, updated_at: new Date() }).where('id', '=', id)
    .where(eb => eb.or([
      eb('owner_user_id', '=', user.userId),
      eb.exists(eb.selectFrom('pt_personal_template_shares').select('id').where('resource_id', '=', id).where('grantee_user_id', '=', user.userId).where('role', '=', 'editor'))
    ]))
    .executeTakeFirst())
  if (!Number(res.numUpdatedRows)) ptNotFound('Template not found.')
  return { ok: true }
})
