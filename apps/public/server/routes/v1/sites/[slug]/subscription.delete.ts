import { withOrg } from '@prayertools/shared/db/scope'
import { setSubscriptionStatus } from '@prayertools/shared/subscriptions'
import { useDb } from '../../../../utils/db'
import { apiSite, appSubscription, requireDevice } from '../../../../utils/app-api'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  const site = await apiSite(getRouterParam(event, 'slug'))
  await withOrg(useDb(), site.orgId, async (tx) => {
    const sub = await appSubscription(tx, device.userId)
    if (sub && sub.status !== 'unsubscribed') await setSubscriptionStatus(tx, sub.id, 'unsubscribed')
  })
  return { ok: true, status: 'unsubscribed' }
})
