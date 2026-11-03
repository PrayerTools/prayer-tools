import { withMySubscription } from '../../../../utils/my'
import { leaveOwnCampaign } from '../../../../utils/sub-actions'
import { limit, readJson } from '../../../../utils/request'

export default defineEventHandler(async (event) => {
  limit(event, 'my', 60, 60_000)
  const body = await readJson(event)
  await withMySubscription(event, (tx, sub) => leaveOwnCampaign(tx, sub, body.campaign))
  return { ok: true }
})
