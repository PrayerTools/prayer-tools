// Where the visitor is in a personal-start campaign, so the shared pray page
// can take a recognised subscriber to their entry. Null for anyone else.
import { withOrg } from '@prayertools/shared/db/scope'
import { campaignById } from '@prayertools/shared/campaigns'
import { openEntry } from '@prayertools/shared/progress'
import { useDb } from '../../utils/db'
import { limit, readJson } from '../../utils/request'
import { siteContext } from '../../utils/site-context'
import { prayingSubscription } from '../../utils/prayer'
import { isUuid } from '../../lib/input'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  limit(event, 'position', 30, 60_000)
  const body = await readJson(event, 2048)
  if (!isUuid(body.campaign)) throw createError({ statusCode: 400 })
  const position = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const campaign = await campaignById(tx, body.campaign)
    if (!campaign) throw createError({ statusCode: 404 })
    const subscriptionId = await prayingSubscription(tx, event, ctx.orgId, body.p)
    return subscriptionId ? await openEntry(tx, subscriptionId, campaign, null) : null
  })
  return { position }
})
