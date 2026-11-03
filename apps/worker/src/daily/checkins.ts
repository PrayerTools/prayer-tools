// Email check-ins, found with one set-based query (rules in plans/README.md "Email check-ins").
// Anchor = latest of signup, activity, cycle start, last answer; an unanswered check-in after it is open.
import { sql } from 'kysely'
import { forEachOrg } from '@prayertools/shared/db/scope'
import { enqueue } from '@prayertools/shared/jobs'
import { FIXED_MAX_DAYS } from '@prayertools/shared/setup'
import { SITE_SETTING_DEFAULTS } from '@prayertools/shared/site'
import { setSubscriptionStatus } from '@prayertools/shared/subscriptions'
import type { WorkerContext } from '../context'
import type { Logger } from '../log'
import { groupBy } from '../util'

export const FIRST_CHECKIN_DAYS = 30
export const LATER_CHECKIN_DAYS = 90
export const CHECKIN_WAIT_DAYS = 7

export type CheckinAction = 'checkin' | 'reminder' | 'inactive' | 'complete_cycle'

export interface CheckinRow {
  id: string
  org_id: string
  action: CheckinAction
}

export async function findCheckinWork(ctx: WorkerContext, now: Date): Promise<CheckinRow[]> {
  const res = await sql<CheckinRow>`
    WITH cand AS (
      SELECT s.id, s.org_id, s.checkin_cycle_started_at,
        greatest(
          s.created_at,
          coalesce(s.last_activity_at, s.created_at),
          coalesce(s.checkin_cycle_started_at, s.created_at),
          coalesce((SELECT max(ch.responded_at) FROM pt_checkin ch WHERE ch.subscription_id = s.id), s.created_at)
        ) AS anchor
      FROM pt_subscription s
      JOIN pt_site st ON st.org_id = s.org_id
      WHERE s.status = 'active' AND s.delivery = 'email' AND s.verified_at IS NOT NULL AND s.anonymized_at IS NULL
        AND st.status = 'published'
        AND CASE WHEN jsonb_typeof(st.settings -> 'checkins_enabled') = 'boolean'
                 THEN (st.settings ->> 'checkins_enabled')::boolean
                 ELSE ${SITE_SETTING_DEFAULTS.checkins_enabled}::boolean END
        AND EXISTS (
          SELECT 1 FROM pt_commitment c JOIN pt_campaign k ON k.id = c.campaign_id
          WHERE c.subscription_id = s.id AND NOT c.paused AND c.left_at IS NULL
            AND (c.ends_on IS NULL OR c.ends_on >= (${now}::timestamptz AT TIME ZONE c.timezone)::date)
            AND k.ended_at IS NULL
            AND (k.start_date IS NULL OR k.start_date <= (${now}::timestamptz AT TIME ZONE k.timezone)::date)
            AND (k.end_date IS NULL OR k.end_date >= (${now}::timestamptz AT TIME ZONE k.timezone)::date)
            AND NOT (k.start_mode = 'date' AND k.end_mode = 'date' AND k.end_date - k.start_date <= ${FIXED_MAX_DAYS})
        )
    ),
    state AS (
      SELECT cand.id, cand.org_id, cand.anchor,
        (SELECT count(*) FROM pt_checkin ch WHERE ch.subscription_id = cand.id AND ch.response IS NULL AND ch.sent_at >= cand.anchor) AS open_count,
        (SELECT max(ch.sent_at) FROM pt_checkin ch WHERE ch.subscription_id = cand.id AND ch.response IS NULL AND ch.sent_at >= cand.anchor) AS last_open_at,
        EXISTS (SELECT 1 FROM pt_checkin ch WHERE ch.subscription_id = cand.id AND ch.sent_at < cand.anchor) AS had_cycle,
        EXISTS (
          SELECT 1 FROM pt_checkin ch
          WHERE ch.subscription_id = cand.id AND ch.response IS NULL AND ch.sent_at < cand.anchor
            AND ch.sent_at > coalesce(cand.checkin_cycle_started_at, '-infinity'::timestamptz)
        ) AS answered_by_activity
      FROM cand
    )
    SELECT id::text AS id, org_id::text AS org_id,
      CASE
        WHEN answered_by_activity THEN 'complete_cycle'
        WHEN open_count >= 2 AND last_open_at <= ${now}::timestamptz - make_interval(days => ${CHECKIN_WAIT_DAYS}) THEN 'inactive'
        WHEN open_count = 1 AND last_open_at <= ${now}::timestamptz - make_interval(days => ${CHECKIN_WAIT_DAYS}) THEN 'reminder'
        WHEN open_count = 0 AND anchor <= ${now}::timestamptz - make_interval(days => CASE WHEN had_cycle THEN ${LATER_CHECKIN_DAYS}::int ELSE ${FIRST_CHECKIN_DAYS}::int END) THEN 'checkin'
      END AS action
    FROM state
    WHERE answered_by_activity
       OR (open_count >= 1 AND last_open_at <= ${now}::timestamptz - make_interval(days => ${CHECKIN_WAIT_DAYS}))
       OR (open_count = 0 AND anchor <= ${now}::timestamptz - make_interval(days => CASE WHEN had_cycle THEN ${LATER_CHECKIN_DAYS}::int ELSE ${FIRST_CHECKIN_DAYS}::int END))
  `.execute(ctx.admin)
  return res.rows
}

export async function runCheckins(ctx: WorkerContext, log: Logger): Promise<Record<CheckinAction, number>> {
  const now = ctx.now()
  const rows = await findCheckinWork(ctx, now)
  const counts: Record<CheckinAction, number> = { checkin: 0, reminder: 0, inactive: 0, complete_cycle: 0 }
  const byOrg = groupBy(rows, r => r.org_id)
  await forEachOrg(ctx.app, byOrg.keys(), async (tx, orgId) => {
    for (const row of byOrg.get(orgId) ?? []) {
      if (row.action === 'complete_cycle') {
        await tx.updateTable('pt_subscription').set({ checkin_cycle_started_at: now, updated_at: now }).where('id', '=', row.id).execute()
      } else if (row.action === 'inactive') {
        await setSubscriptionStatus(tx, row.id, 'inactive')
      } else {
        const job = await enqueue(tx, 'checkin_email', { subscriptionId: row.id, kind: row.action }, { orgId, referenceType: 'subscription_checkin', referenceId: row.id })
        if (!job) continue
      }
      counts[row.action]++
    }
  }, (orgId, err) => log.error('checkins.failed', { site: orgId, err }))
  return counts
}
