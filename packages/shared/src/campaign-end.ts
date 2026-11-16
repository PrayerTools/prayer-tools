// Ending a campaign, for the worker's end-date sweep and the admin's "End
// campaign" alike. Runs inside the site's org.
import type { Tx } from './db/scope'
import { enqueue } from './jobs'

// Marks the campaign ended, stops its reminders and, on a published site,
// queues its thank-you. A campaign ends once: a second call changes nothing.
export async function endCampaign(tx: Tx, campaignId: string, now: Date = new Date()): Promise<{ ended: boolean, queued: boolean }> {
  const ended = await tx
    .updateTable('pt_campaign')
    .set({ ended_at: now, updated_at: now })
    .where('id', '=', campaignId)
    .where('ended_at', 'is', null)
    .returning('org_id')
    .executeTakeFirst()
  if (!ended) return { ended: false, queued: false }
  await tx.updateTable('pt_commitment').set({ next_reminder_utc: null, claimed_at: null }).where('campaign_id', '=', campaignId).execute()
  const site = await tx.selectFrom('pt_site').select('status').where('org_id', '=', ended.org_id).executeTakeFirst()
  if (site?.status !== 'published') return { ended: true, queued: false }
  const job = await enqueue(tx, 'thank_you', { campaignId }, { orgId: ended.org_id, referenceType: 'campaign', referenceId: campaignId })
  return { ended: true, queued: !!job }
}

// Who a campaign's thank-you email goes to: verified, not unsubscribed, with
// prayer times in it they neither left nor finished (finishing is thanked then).
export function thankYouAudience(tx: Tx, campaignId: string) {
  return tx
    .selectFrom('pt_subscription as s')
    .where('s.delivery', '=', 'email')
    .where('s.verified_at', 'is not', null)
    .where('s.status', '<>', 'unsubscribed')
    .where('s.anonymized_at', 'is', null)
    .where(eb => eb.exists(eb
      .selectFrom('pt_commitment as c')
      .select('c.id')
      .whereRef('c.subscription_id', '=', 's.id')
      .where('c.campaign_id', '=', campaignId)
      .where('c.left_at', 'is', null)
      .where('c.finished_at', 'is', null)))
}
