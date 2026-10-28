import { withOrg } from '@prayertools/shared/db/scope'
import { useDb } from '../../../../../utils/db'
import { readJson } from '../../../../../utils/request'
import { apiSite, appSubscription, commitmentJson, requireDevice } from '../../../../../utils/app-api'
import { patchCommitment } from '../../../../../utils/sub-actions'
import { isUuid } from '../../../../../lib/input'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  const site = await apiSite(getRouterParam(event, 'slug'))
  const id = getRouterParam(event, 'id')
  if (!isUuid(id)) throw createError({ statusCode: 404 })
  const body = await readJson(event, 16_384)
  return await withOrg(useDb(), site.orgId, async (tx) => {
    const sub = await appSubscription(tx, device.userId)
    if (!sub) throw createError({ statusCode: 404 })
    await patchCommitment(tx, sub, id, body)
    return commitmentJson(await tx.selectFrom('pt_commitment').selectAll().where('id', '=', id).executeTakeFirstOrThrow())
  })
})
