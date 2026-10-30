// Prayer session ping from the app (same upsert as the web, source `app`).
import { withOrg } from '@prayertools/shared/db/scope'
import { campaignById } from '@prayertools/shared/campaigns'
import { prayingNow } from '@prayertools/shared/stats'
import { openEntry } from '@prayertools/shared/progress'
import { useDb } from '../../../../utils/db'
import { limit, readJson } from '../../../../utils/request'
import { apiSite, appSubscription, requireDevice } from '../../../../utils/app-api'
import { recordPing } from '../../../../utils/prayer'
import { isUuid } from '../../../../lib/input'
import { forwardInBackground } from '../../../../utils/analytics'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  limit(event, 'v1-ping', 30, 60_000)
  const site = await apiSite(getRouterParam(event, 'slug'))
  const body = await readJson(event, 4096)
  if (!isUuid(body.id) || !isUuid(body.campaign)) throw createError({ statusCode: 400 })
  const day = Number.isInteger(body.day) && (body.day as number) > 0 ? body.day as number : null
  const language = typeof body.language === 'string' ? body.language.slice(0, 10) : null
  const result = await withOrg(useDb(), site.orgId, async (tx) => {
    const campaign = await campaignById(tx, body.campaign)
    if (!campaign) throw createError({ statusCode: 404 })
    const sub = await appSubscription(tx, device.intercessorId)
    const ping = await recordPing(tx, {
      id: body.id as string, campaignId: campaign.id, timezone: campaign.timezone, day, language, source: 'app',
      subscriptionId: sub?.id ?? null, intercessorId: device.intercessorId, country: getRequestHeader(event, 'cf-ipcountry')?.slice(0, 2) ?? null
    })
    if (ping.first && sub) await openEntry(tx, sub.id, campaign, day)
    return { ping, now: await prayingNow(tx) }
  })
  if (result.ping.first) {
    forwardInBackground(event, { orgId: site.orgId, slug: site.slug }, { event_type: 'prayer_fuel_viewed', anonymous_hash: device.deviceId, language, campaignId: body.campaign as string, metadata: { source: 'app', content_day: day } })
  }
  return { ok: true, praying_now: result.now }
})
