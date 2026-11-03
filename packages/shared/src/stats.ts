// Per-site stats: daily counters per site and campaign, kept indefinitely;
// raw events for a limited window. Everything runs inside the site's org.
import { sql } from 'kysely'
import type { Tx } from './db/scope'
import type { Goal } from './db/schema'
import { displayLength, slotMinutes, type CampaignDates } from './setup'
import { todayIn } from './dates'
import { buildGrid, coveragePercent } from './coverage'
import type { CommitmentRule } from './schedule'

const NO_CAMPAIGN = '00000000-0000-0000-0000-000000000000'

export const METRICS = ['pageviews', 'visitors', 'signups', 'verifications', 'prayers', 'prayer_seconds', 'shares', 'share_signups', 'stories', 'group_prayers'] as const
export type Metric = typeof METRICS[number]

export async function bumpStat(tx: Tx, campaignId: string | null, day: string, metric: Metric, by = 1): Promise<void> {
  if (!by) return
  await sql`
    INSERT INTO pt_stat_daily (campaign_id, day, metric, value)
    VALUES (${campaignId}, ${day}, ${metric}, ${by})
    ON CONFLICT (org_id, (coalesce(campaign_id, ${NO_CAMPAIGN}::uuid)), day, metric)
    DO UPDATE SET value = pt_stat_daily.value + EXCLUDED.value
  `.execute(tx)
}

export async function bumpDim(tx: Tx, campaignId: string | null, day: string, dim: string, key: string, by = 1): Promise<void> {
  const k = key.slice(0, 120)
  if (!k) return
  await sql`
    INSERT INTO pt_stat_dim_daily (campaign_id, day, dim, key, value)
    VALUES (${campaignId}, ${day}, ${dim}, ${k}, ${by})
    ON CONFLICT (org_id, (coalesce(campaign_id, ${NO_CAMPAIGN}::uuid)), day, dim, key)
    DO UPDATE SET value = pt_stat_dim_daily.value + EXCLUDED.value
  `.execute(tx)
}

// True the first time a visitor is seen on the site that day.
export async function recordVisitor(tx: Tx, day: string, visitorHash: string): Promise<boolean> {
  const row = await tx
    .insertInto('pt_stat_visitor_day')
    .values({ day, visitor_hash: visitorHash })
    .onConflict(oc => oc.doNothing())
    .returning('day')
    .executeTakeFirst()
  return !!row
}

export async function recordEvent(tx: Tx, e: { campaignId: string | null, type: string, visitorHash?: string | null, country?: string | null, source?: string | null, meta?: Record<string, unknown> }): Promise<void> {
  await tx
    .insertInto('pt_event')
    .values({
      campaign_id: e.campaignId,
      type: e.type,
      visitor_hash: e.visitorHash ?? null,
      country: e.country ?? null,
      source: e.source ?? null,
      meta: sql`${JSON.stringify(e.meta ?? {})}::text::jsonb`
    })
    .execute()
}

export interface CampaignForCount extends CampaignDates {
  id: string
  goal: Goal
  goal_target: number | null
  slot_min?: number | null
}

// People signed up to a campaign. Web people count once their email is
// verified; app people once they joined and created a reminder. Fixed
// campaigns count everyone who committed (completed included); ongoing ones
// count people with an active commitment.
export async function peopleCount(tx: Tx, c: CampaignForCount, now: Date = new Date()): Promise<number> {
  const today = todayIn(c.timezone, now)
  const fixed = displayLength(c) === 'fixed'
  let q = tx
    .selectFrom('pt_commitment as cm')
    .innerJoin('pt_subscription as s', 's.id', 'cm.subscription_id')
    .select(eb => eb.fn.count<string>('s.id').distinct().as('n'))
    .where('cm.campaign_id', '=', c.id)
    .where(eb => eb.or([eb('s.verified_at', 'is not', null), eb('s.delivery', '=', 'app')]))
    .where('s.anonymized_at', 'is', null)
  if (!fixed) {
    q = q
      .where('s.status', '=', 'active')
      .where('cm.paused', '=', false)
      .where('cm.left_at', 'is', null)
      .where(eb => eb.or([eb('cm.ends_on', 'is', null), eb('cm.ends_on', '>=', today)]))
  }
  const row = await q.executeTakeFirst()
  return Number(row?.n ?? 0)
}

export async function activeRules(tx: Tx, campaignId: string): Promise<(CommitmentRule & { subscription_id: string })[]> {
  const rows = await tx
    .selectFrom('pt_commitment as cm')
    .innerJoin('pt_subscription as s', 's.id', 'cm.subscription_id')
    .select(['cm.subscription_id', 'cm.kind', 'cm.frequency', 'cm.days_of_week', 'cm.time', 'cm.timezone', 'cm.duration_min', 'cm.dates', 'cm.starts_on', 'cm.ends_on', 'cm.paused'])
    .where('cm.campaign_id', '=', campaignId)
    .where('s.status', '=', 'active')
    .where(eb => eb.or([eb('s.verified_at', 'is not', null), eb('s.delivery', '=', 'app')]))
    .execute()
  return rows.map(r => ({
    ...r,
    starts_on: typeof r.starts_on === 'string' ? r.starts_on : new Date(r.starts_on as unknown as Date).toISOString().slice(0, 10),
    ends_on: r.ends_on ? (typeof r.ends_on === 'string' ? r.ends_on : new Date(r.ends_on as unknown as Date).toISOString().slice(0, 10)) : null
  }))
}

export interface GoalProgress {
  goal: Goal
  people: number
  // prayer_time: committed minutes per day; coverage: percent of slots covered.
  value: number
  target: number | null
  percent: number | null
}

export async function goalProgress(tx: Tx, c: CampaignForCount, defaultMinutes = 15, now: Date = new Date()): Promise<GoalProgress> {
  const people = await peopleCount(tx, c, now)
  if (c.goal === 'people') {
    const target = c.goal_target
    return { goal: c.goal, people, value: people, target, percent: target ? Math.min(100, Math.round(people / target * 100)) : null }
  }
  const rules = await activeRules(tx, c.id)
  if (c.goal === 'prayer_time') {
    let perDay = 0
    for (const r of rules) {
      if (r.paused) continue
      const minutes = r.duration_min ?? defaultMinutes
      perDay += r.kind === 'dates' ? 0 : r.frequency === 'daily' ? minutes : minutes * r.days_of_week.length / 7
    }
    const target = c.goal_target ?? 1440
    return { goal: c.goal, people, value: Math.round(perDay), target, percent: Math.min(100, Math.round(perDay / target * 100)) }
  }
  if (c.start_date && c.end_date) {
    const grid = buildGrid(c.start_date, c.end_date, c.timezone, rules, defaultMinutes, slotMinutes(c))
    const pct = coveragePercent(grid.slots)
    return { goal: c.goal, people, value: pct, target: 100, percent: Math.round(pct) }
  }
  return { goal: c.goal, people, value: 0, target: 100, percent: 0 }
}

export async function prayingNow(tx: Tx, windowSeconds = 90): Promise<number> {
  const row = await tx
    .selectFrom('pt_prayer_session')
    .select(eb => eb.fn.countAll<string>().as('n'))
    .where('last_ping_at', '>', new Date(Date.now() - windowSeconds * 1000))
    .where('started_at', '>', new Date(Date.now() - 6 * 3600 * 1000))
    .where('completed', '=', false)
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

export async function statTotals(tx: Tx, campaignId: string | null, from?: string, to?: string): Promise<Record<string, number>> {
  let q = tx.selectFrom('pt_stat_daily').select(['metric', eb => eb.fn.sum<string>('value').as('total')]).groupBy('metric')
  q = campaignId ? q.where('campaign_id', '=', campaignId) : q
  if (from) q = q.where('day', '>=', from)
  if (to) q = q.where('day', '<=', to)
  const rows = await q.execute()
  return Object.fromEntries(rows.map(r => [r.metric, Number(r.total ?? 0)]))
}
