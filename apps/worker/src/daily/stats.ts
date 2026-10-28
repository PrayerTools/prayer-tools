// Stats refresh for sites with recent activity: directory people count and current campaign,
// and the coverage cache of long 24/7 campaigns.
import { sql } from 'kysely'
import { forEachOrg, type Tx } from '@prayertools/shared/db/scope'
import { jsonb } from '@prayertools/shared/db/json'
import { buildGrid } from '@prayertools/shared/coverage'
import { campaignStatus, pickCurrentCampaign, slotMinutes } from '@prayertools/shared/setup'
import { siteSettings } from '@prayertools/shared/site'
import { activeRules, peopleCount } from '@prayertools/shared/stats'
import { daysBetween } from '@prayertools/shared/dates'
import { loadCampaigns } from '@prayertools/shared/campaigns'
import type { WorkerContext } from '../context'
import type { Logger } from '../log'
import { DAY } from '../util'

// Coverage of campaigns longer than this is cached; shorter ones are
// expanded on request by the public server.
export const LONG_COVERAGE_DAYS = 60
const RECENT_MS = 26 * 60 * 60 * 1000

export async function sitesWithRecentActivity(ctx: WorkerContext, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - RECENT_MS)
  const res = await sql<{ org_id: string }>`
    SELECT org_id::text AS org_id FROM pt_prayer_session WHERE started_at > ${new Date(since.getTime() - DAY)}::timestamptz AND last_ping_at > ${since}::timestamptz
    UNION SELECT org_id::text FROM pt_subscription WHERE updated_at > ${since}::timestamptz
    UNION SELECT org_id::text FROM pt_commitment WHERE updated_at > ${since}::timestamptz
    UNION SELECT org_id::text FROM pt_campaign WHERE updated_at > ${since}::timestamptz OR ended_at > ${since}::timestamptz
      OR start_date = (${now}::timestamptz AT TIME ZONE timezone)::date
    UNION SELECT k.org_id::text FROM pt_campaign k
      WHERE k.goal = 'coverage' AND k.start_mode = 'date' AND k.end_mode = 'date' AND k.end_date - k.start_date > ${LONG_COVERAGE_DAYS}
        AND k.ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM pt_coverage_cache cc WHERE cc.campaign_id = k.id)
  `.execute(ctx.admin)
  return res.rows.map(r => r.org_id)
}

async function refreshDirectory(tx: Tx, orgId: string, now: Date): Promise<boolean> {
  const entry = await tx.selectFrom('pt_directory_entry').select('status').where('org_id', '=', orgId).where('status', 'in', ['listed', 'requested']).executeTakeFirst()
  if (!entry) return false
  const current = pickCurrentCampaign(await loadCampaigns(tx), now)
  const people = current ? await peopleCount(tx, current.campaign, now) : 0
  await tx
    .updateTable('pt_directory_entry')
    .set({
      people_count: people,
      campaign_name: current?.campaign.name ?? null,
      campaign_starts_on: current?.campaign.start_date ?? null,
      updated_at: now
    })
    .where('org_id', '=', orgId)
    .execute()
  return true
}

async function refreshCoverage(tx: Tx, now: Date): Promise<number> {
  const site = await tx.selectFrom('pt_site').select('settings').executeTakeFirst()
  const defaultMinutes = siteSettings(site?.settings as Record<string, unknown> | undefined).default_duration_min
  const campaigns = await tx
    .selectFrom('pt_campaign')
    .selectAll()
    .where('goal', '=', 'coverage')
    .where('start_mode', '=', 'date')
    .where('end_mode', '=', 'date')
    .where('ended_at', 'is', null)
    .execute()
  let n = 0
  for (const c of campaigns) {
    if (!c.start_date || !c.end_date || daysBetween(c.start_date, c.end_date) <= LONG_COVERAGE_DAYS) continue
    if (campaignStatus(c, now) === 'ended') continue
    const grid = buildGrid(c.start_date, c.end_date, c.timezone, await activeRules(tx, c.id), defaultMinutes, slotMinutes(c))
    await tx
      .insertInto('pt_coverage_cache')
      .values({ campaign_id: c.id, slots: jsonb(grid.slots), computed_at: now })
      .onConflict(oc => oc.column('campaign_id').doUpdateSet({ slots: jsonb(grid.slots), computed_at: now }))
      .execute()
    n++
  }
  return n
}

export async function refreshStats(ctx: WorkerContext, log: Logger): Promise<Record<string, number>> {
  const now = ctx.now()
  const orgIds = await sitesWithRecentActivity(ctx, now)
  let directory = 0
  let coverage = 0
  await forEachOrg(ctx.app, orgIds, async (tx, orgId) => {
    if (await refreshDirectory(tx, orgId, now)) directory++
    coverage += await refreshCoverage(tx, now)
  }, (orgId, err) => log.error('stats.refresh_failed', { site: orgId, err }))
  return { sites: orgIds.length, directory, coverage }
}
