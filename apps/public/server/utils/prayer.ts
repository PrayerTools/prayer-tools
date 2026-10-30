// Prayer sessions, upserted from pings (web and app): the first ping counts a
// prayer, later pings add the time since the previous ping, capped so a gap
// with the page closed or hidden isn't counted. Sessions are partitioned by
// start time, so a session is only continued within 6 hours of its start.
import { sql } from 'kysely'
import type { Tx } from '@prayertools/shared/db/scope'
import type { SessionSource } from '@prayertools/shared/db/schema'
import { bumpStat } from '@prayertools/shared/stats'
import { todayIn } from '@prayertools/shared/dates'
import { recordActivity } from '@prayertools/shared/subscriptions'
import { parseLink } from '@prayertools/shared/links'
import type { H3Event } from 'h3'
import { managedSubscription } from './manage'

export const MAX_SESSION_SECONDS = 2 * 3600
const MAX_PING_GAP_SECONDS = 60

export interface PingInput {
  id: string
  campaignId: string
  timezone: string
  day: number | null
  language: string | null
  source: SessionSource
  subscriptionId: string | null
  intercessorId: string | null
  country: string | null
}

export interface PingResult {
  first: boolean
  delta: number
  subscriptionId: string | null
}

export async function recordPing(tx: Tx, p: PingInput): Promise<PingResult> {
  const updated = await sql<{ seconds: number, old: number, subscription_id: string | null }>`
    UPDATE pt_prayer_session s
       SET last_ping_at = now(),
           seconds = LEAST(s.seconds + LEAST(GREATEST(extract(epoch from now() - s.last_ping_at), 0), ${MAX_PING_GAP_SECONDS})::int, ${MAX_SESSION_SECONDS})
      FROM (SELECT id, started_at, seconds AS old FROM pt_prayer_session
             WHERE id = ${p.id} AND started_at > now() - interval '6 hours' FOR UPDATE) o
     WHERE s.id = o.id AND s.started_at = o.started_at AND NOT s.completed
    RETURNING s.seconds, o.old, s.subscription_id
  `.execute(tx)
  const row = updated.rows[0]
  let result: PingResult
  if (row) {
    result = { first: false, delta: Math.max(0, row.seconds - row.old), subscriptionId: row.subscription_id }
  } else {
    const exists = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pt_prayer_session WHERE id = ${p.id} AND started_at > now() - interval '6 hours'`.execute(tx)
    if ((exists.rows[0]?.n ?? 0) > 0) return { first: false, delta: 0, subscriptionId: null }
    await tx.insertInto('pt_prayer_session').values({
      id: p.id,
      campaign_id: p.campaignId,
      subscription_id: p.subscriptionId,
      intercessor_id: p.intercessorId,
      source: p.source,
      day: p.day,
      language: p.language,
      country: p.country
    }).execute()
    result = { first: true, delta: 0, subscriptionId: p.subscriptionId }
  }
  await countPrayer(tx, p.campaignId, p.timezone, result.subscriptionId, result.first ? 1 : 0, result.delta)
  return result
}

// Campaign stats and the person's own totals.
export async function countPrayer(tx: Tx, campaignId: string, timezone: string, subscriptionId: string | null, prayers: number, seconds: number): Promise<void> {
  const day = todayIn(timezone)
  if (prayers) await bumpStat(tx, campaignId, day, 'prayers', prayers)
  if (seconds) await bumpStat(tx, campaignId, day, 'prayer_seconds', seconds)
  if (!subscriptionId || (!prayers && !seconds)) return
  await sql`
    INSERT INTO pt_person_total (campaign_id, subscription_id, prayers, seconds, last_prayed_at)
    VALUES (${campaignId}, ${subscriptionId}, ${prayers}, ${seconds}, now())
    ON CONFLICT (campaign_id, subscription_id) DO UPDATE
      SET prayers = pt_person_total.prayers + EXCLUDED.prayers,
          seconds = pt_person_total.seconds + EXCLUDED.seconds,
          last_prayed_at = now()
  `.execute(tx)
  if (prayers) await recordActivity(tx, subscriptionId)
}

export async function markAmen(tx: Tx, id: string): Promise<boolean> {
  const res = await sql`UPDATE pt_prayer_session SET completed = true, last_ping_at = now() WHERE id = ${id} AND started_at > now() - interval '6 hours' AND NOT completed`.execute(tx)
  return Number(res.numAffectedRows ?? 0) > 0
}

// The subscriber a pray-page request belongs to: the personal token from a
// reminder link, else the manage cookie set when they confirmed or managed.
export async function prayingSubscription(tx: Tx, event: H3Event, orgId: string, token: unknown): Promise<string | null> {
  const link = typeof token === 'string' ? parseLink(token, 'p') : null
  if (link && link.orgId === orgId) {
    const sub = await tx.selectFrom('pt_subscription').select('id').where('id', '=', link.subscriptionId).where('anonymized_at', 'is', null).executeTakeFirst()
    if (sub) return sub.id
  }
  return (await managedSubscription(tx, event, orgId))?.id ?? null
}
