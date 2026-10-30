// "Praying as a group — how many?": counts the group's prayers.
import { sql } from 'kysely'
import { withOrg } from '@prayertools/shared/db/scope'
import { campaignById } from '@prayertools/shared/campaigns'
import { bumpStat } from '@prayertools/shared/stats'
import { todayIn } from '@prayertools/shared/dates'
import { useDb } from '../../utils/db'
import { limit, readJson } from '../../utils/request'
import { siteContext } from '../../utils/site-context'
import { isUuid } from '../../lib/input'
import { forwardInBackground } from '../../utils/analytics'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  limit(event, 'group', 5, 60_000)
  const body = await readJson(event, 1024)
  const count = Math.round(Number(body.count))
  if (!isUuid(body.campaign) || !Number.isFinite(count) || count < 2 || count > 10_000) throw createError({ statusCode: 400 })
  await withOrg(useDb(), ctx.orgId, async (tx) => {
    const campaign = await campaignById(tx, body.campaign)
    if (!campaign) throw createError({ statusCode: 404 })
    await bumpStat(tx, campaign.id, todayIn(campaign.timezone), 'group_prayers', count)
    if (isUuid(body.id)) await sql`UPDATE pt_prayer_session SET group_size = ${count} WHERE id = ${body.id} AND started_at > now() - interval '6 hours'`.execute(tx)
  })
  forwardInBackground(event, { orgId: ctx.orgId, slug: ctx.slug, host: ctx.host }, {
    event_type: 'prayer_recorded',
    value: count,
    campaignId: body.campaign as string,
    metadata: { content_day: Number.isInteger(body.day) ? body.day : undefined }
  })
  return { ok: true }
})
