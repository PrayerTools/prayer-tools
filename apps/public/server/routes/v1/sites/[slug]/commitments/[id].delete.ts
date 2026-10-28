import { withOrg } from '@prayertools/shared/db/scope'
import { useDb } from '../../../../../utils/db'
import { apiSite, appSubscription, requireDevice } from '../../../../../utils/app-api'
import { removeCommitment } from '../../../../../utils/sub-actions'
import { isUuid } from '../../../../../lib/input'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  const site = await apiSite(getRouterParam(event, 'slug'))
  const id = getRouterParam(event, 'id')
  if (!isUuid(id)) throw createError({ statusCode: 404 })
  await withOrg(useDb(), site.orgId, async (tx) => {
    const sub = await appSubscription(tx, device.userId)
    if (!sub) throw createError({ statusCode: 404 })
    await removeCommitment(tx, sub, id)
  })
  return { ok: true }
})
