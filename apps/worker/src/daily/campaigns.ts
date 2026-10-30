// Campaign ends: close date-ended campaigns, finish personal-start commitments and complete
// subscriptions with nothing left open, queueing each thank-you in the same transaction as the
// state change so it is queued once.
import { sql } from 'kysely'
import { forEachOrg } from '@prayertools/shared/db/scope'
import { enqueue } from '@prayertools/shared/jobs'
import { contentLengthSql } from '@prayertools/shared/content'
import { setSubscriptionStatus } from '@prayertools/shared/subscriptions'
import type { WorkerContext } from '../context'
import type { Logger } from '../log'
import { groupBy } from '../util'

export async function closeEndedCampaigns(ctx: WorkerContext, log: Logger): Promise<Record<string, number>> {
  const now = ctx.now()
  const due = await sql<{ id: string, org_id: string }>`
    SELECT k.id::text AS id, k.org_id::text AS org_id
    FROM pt_campaign k
    WHERE k.end_mode = 'date' AND k.ended_at IS NULL AND k.published_at IS NOT NULL
      AND k.end_date < (${now}::timestamptz AT TIME ZONE k.timezone)::date
  `.execute(ctx.admin)
  let closed = 0
  let queued = 0
  await forEachOrg(ctx.app, groupBy(due.rows, r => r.org_id).keys(), async (tx, orgId) => {
    const site = await tx.selectFrom('pt_site').select('status').executeTakeFirst()
    for (const { id } of due.rows.filter(r => r.org_id === orgId)) {
      const updated = await tx.updateTable('pt_campaign').set({ ended_at: now, updated_at: now }).where('id', '=', id).where('ended_at', 'is', null).returning('id').executeTakeFirst()
      if (!updated) continue
      closed++
      await tx.updateTable('pt_commitment').set({ next_reminder_utc: null, claimed_at: null }).where('campaign_id', '=', id).execute()
      if (site?.status === 'published') {
        const job = await enqueue(tx, 'thank_you', { campaignId: id }, { orgId, referenceType: 'campaign', referenceId: id })
        if (job) queued++
      }
      log.info('campaign.closed', { site: orgId, campaign: id })
    }
  }, (orgId, err) => log.error('campaign.close_failed', { site: orgId, err }))
  return { closed, queued }
}

// A personal-start commitment is finished once the person has gone through
// the campaign's entries: it is marked and thanked then, whatever else they
// pray in. A subscription is completed when nothing is left open: every
// personal-start commitment finished, and every other one past its last day
// or in an ended campaign.
export async function completePersonalStart(ctx: WorkerContext, log: Logger): Promise<Record<string, number>> {
  const now = ctx.now()
  const finished = await sql<{ id: string, org_id: string, subscription_id: string, campaign_id: string }>`
    SELECT c.id::text AS id, c.org_id::text AS org_id, c.subscription_id::text AS subscription_id, c.campaign_id::text AS campaign_id
    FROM pt_commitment c
    JOIN pt_campaign k ON k.id = c.campaign_id
    JOIN pt_subscription s ON s.id = c.subscription_id
    WHERE s.status = 'active' AND k.start_mode = 'join' AND k.end_mode = 'days' AND c.finished_at IS NULL
      AND c.entries_done >= coalesce(k.length_days, nullif(${contentLengthSql(sql.ref('k.id'))}, 0))
  `.execute(ctx.admin)
  let queued = 0
  await forEachOrg(ctx.app, groupBy(finished.rows, r => r.org_id).keys(), async (tx, orgId) => {
    for (const c of finished.rows.filter(r => r.org_id === orgId)) {
      const marked = await tx.updateTable('pt_commitment').set({ finished_at: now, next_reminder_utc: null, claimed_at: null }).where('id', '=', c.id).where('finished_at', 'is', null).returning('id').executeTakeFirst()
      if (!marked) continue
      const job = await enqueue(tx, 'thank_you_person', { subscriptionId: c.subscription_id, campaignId: c.campaign_id }, { orgId, referenceType: 'subscription_campaign', referenceId: `${c.subscription_id}:${c.campaign_id}` })
      if (job) queued++
    }
  }, (orgId, err) => log.error('personal_finish.failed', { site: orgId, err }))

  const due = await sql<{ id: string, org_id: string }>`
    SELECT s.id::text AS id, s.org_id::text AS org_id
    FROM pt_subscription s
    WHERE s.status = 'active'
      AND EXISTS (
        SELECT 1 FROM pt_commitment c JOIN pt_campaign k ON k.id = c.campaign_id
        WHERE c.subscription_id = s.id AND k.start_mode = 'join'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pt_commitment c
        JOIN pt_campaign k ON k.id = c.campaign_id
        WHERE c.subscription_id = s.id
          AND CASE WHEN k.start_mode = 'join'
            THEN c.finished_at IS NULL
            ELSE k.ended_at IS NULL AND (c.ends_on IS NULL OR c.ends_on >= (${now}::timestamptz AT TIME ZONE c.timezone)::date) END
      )
  `.execute(ctx.admin)
  let completed = 0
  await forEachOrg(ctx.app, groupBy(due.rows, r => r.org_id).keys(), async (tx, orgId) => {
    for (const { id } of due.rows.filter(r => r.org_id === orgId)) {
      const sub = await tx.selectFrom('pt_subscription').select('status').where('id', '=', id).executeTakeFirst()
      if (sub?.status !== 'active') continue
      await setSubscriptionStatus(tx, id, 'completed')
      completed++
    }
  }, (orgId, err) => log.error('personal_completion.failed', { site: orgId, err }))
  return { completed, queued }
}
