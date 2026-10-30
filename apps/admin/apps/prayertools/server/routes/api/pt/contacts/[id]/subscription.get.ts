// The prayer.tools side of a CRM contact: subscription, prayer times,
// check-in history and prayer totals. The contact record itself (name, email,
// signup answers, consent) is shown by the CRM.
import { campaignEntries } from '@prayertools/shared/content'
import { toIsoDate } from '@prayertools/shared/dates'
import { campaignById } from '@prayertools/shared/campaigns'

export default definePtHandler('pt.intercessors.read', async (event, tx) => {
  const contactId = getRouterParam(event, 'id')!
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('contact_id', '=', contactId).executeTakeFirst()
  if (!sub) return { subscription: null }
  const commitments = await tx.selectFrom('pt_commitment as c').innerJoin('pt_campaign as k', 'k.id', 'c.campaign_id')
    .select(['c.id', 'c.campaign_id', 'k.name as campaign_name', 'k.start_mode', 'c.kind', 'c.frequency', 'c.days_of_week', 'c.time', 'c.timezone', 'c.duration_min', 'c.dates', 'c.starts_on', 'c.ends_on', 'c.paused', 'c.next_reminder_utc', 'c.entries_done', 'c.advanced_on'])
    .where('c.subscription_id', '=', sub.id).orderBy('c.created_at').execute()
  // Personal-start campaigns: how far through the content each person is.
  const entries = new Map<string, number | null>()
  for (const c of commitments) {
    if (c.start_mode !== 'join' || entries.has(c.campaign_id)) continue
    const campaign = await campaignById(ptTx(tx), c.campaign_id, { drafts: true })
    entries.set(c.campaign_id, campaign ? await campaignEntries(ptTx(tx), campaign) : null)
  }
  const checkins = await tx.selectFrom('pt_checkin').select(['kind', 'sent_at', 'response', 'responded_at']).where('subscription_id', '=', sub.id).orderBy('sent_at', 'desc').execute()
  const totals = await tx.selectFrom('pt_person_total as t').innerJoin('pt_campaign as k', 'k.id', 't.campaign_id')
    .select(['k.name as campaign_name', 't.prayers', 't.seconds', 't.last_prayed_at']).where('t.subscription_id', '=', sub.id).execute()
  const { verify_token_hash: _v, ...subscription } = sub
  return {
    subscription,
    commitments: commitments.map(c => ({
      ...c,
      starts_on: toIsoDate(c.starts_on as unknown as Date | string | null),
      ends_on: toIsoDate(c.ends_on as unknown as Date | string | null),
      advanced_on: toIsoDate(c.advanced_on as unknown as Date | string | null),
      entries: entries.get(c.campaign_id) ?? null
    })),
    checkins,
    totals
  }
})
