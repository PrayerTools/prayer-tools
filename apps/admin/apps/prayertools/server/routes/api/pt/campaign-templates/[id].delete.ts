// Deletes a campaign template; only its owner. Campaigns made from it keep everything they took.
import { withUserContext } from '#core/server/utils/personal-apps'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  const res = await withUserContext(event, { appId: PT_LIBRARY_APP }, tx => ptTx(tx).deleteFrom('pt_personal_template').where('id', '=', getRouterParam(event, 'id')!).where('owner_user_id', '=', user.userId).executeTakeFirst())
  if (!Number(res.numDeletedRows)) ptNotFound('Template not found.')
  return { ok: true }
})
