// "Amen" from the app with a client-generated id, used as the session id:
// repeats are ignored, so prayers made offline sync later without double
// counting. A session that was pinged is completed; otherwise one is
// recorded as a finished prayer at `prayed_at`.
import { sql } from 'kysely'
import { withOrg } from '@prayertools/shared/db/scope'
import { campaignById } from '@prayertools/shared/campaigns'
import { openEntry } from '@prayertools/shared/progress'
import { useDb } from '../../../../utils/db'
import { limit, readJson } from '../../../../utils/request'
import { apiSite, appSubscription, requireDevice } from '../../../../utils/app-api'
import { countPrayer, MAX_SESSION_SECONDS } from '../../../../utils/prayer'
import { isUuid } from '../../../../lib/input'
import { forwardInBackground } from '../../../../utils/analytics'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  limit(event, 'v1-amen', 60, 60_000)
  const site = await apiSite(getRouterParam(event, 'slug'))
  const body = await readJson(event, 4096)
  if (!isUuid(body.id) || !isUuid(body.campaign)) throw createError({ statusCode: 400 })
  const day = Number.isInteger(body.day) && (body.day as number) > 0 ? body.day as number : null
  const language = typeof body.language === 'string' ? body.language.slice(0, 10) : null
  const prayedAt = typeof body.prayed_at === 'string' && !Number.isNaN(Date.parse(body.prayed_at)) ? new Date(body.prayed_at) : new Date()
  if (prayedAt.getTime() > Date.now() + 300_000 || prayedAt.getTime() < Date.now() - 90 * 86_400_000) throw createError({ statusCode: 400, statusMessage: 'prayed_at' })
  const seconds = Math.min(MAX_SESSION_SECONDS, Math.max(0, Math.round(Number(body.seconds) || 0)))
  const created = await withOrg(useDb(), site.orgId, async (tx) => {
    const campaign = await campaignById(tx, body.campaign)
    if (!campaign) throw createError({ statusCode: 404 })
    const existing = await sql<{ completed: boolean }>`SELECT completed FROM pt_prayer_session WHERE id = ${body.id} LIMIT 1`.execute(tx)
    if (existing.rows[0]) {
      if (!existing.rows[0].completed) await sql`UPDATE pt_prayer_session SET completed = true, last_ping_at = now() WHERE id = ${body.id}`.execute(tx)
      return false
    }
    const sub = await appSubscription(tx, device.intercessorId)
    await tx.insertInto('pt_prayer_session').values({
      id: body.id as string, campaign_id: campaign.id, subscription_id: sub?.id ?? null, intercessor_id: device.intercessorId,
      source: 'app', day, language, country: getRequestHeader(event, 'cf-ipcountry')?.slice(0, 2) ?? null,
      started_at: prayedAt, last_ping_at: new Date(prayedAt.getTime() + seconds * 1000), seconds, completed: true
    }).execute()
    await countPrayer(tx, campaign.id, campaign.timezone, sub?.id ?? null, 1, seconds)
    if (sub) await openEntry(tx, sub.id, campaign, day)
    return true
  })
  if (created) {
    forwardInBackground(event, { orgId: site.orgId, slug: site.slug }, { event_type: 'prayer_fuel_viewed', anonymous_hash: device.deviceId, language, campaignId: body.campaign as string, metadata: { source: 'app', content_day: day, offline: true } })
  }
  return { ok: true, recorded: created }
})
