// Stops every prayer reminder and email for an account across Prayer.Tools,
// for My prayer and the unsubscribe page. Nothing is deleted.
import { withOrg, withPerson, type Db, type Tx } from './db/scope'
import { setConsent, type ConsentCapture } from './crm'
import { setSubscriptionStatus } from './subscriptions'

// Visits each site the account subscribes on, plus `newsOrgId` (the org that
// holds News from Prayer.Tools), one org per transaction.
export async function unsubscribeEverywhere(db: Db, userId: string, opts: { newsOrgId?: string | null, capture: ConsentCapture }): Promise<void> {
  const subs = await withPerson(db, userId, tx => tx
    .selectFrom('pt_subscription')
    .select('org_id')
    .where('user_id', '=', userId)
    .where('anonymized_at', 'is', null)
    .execute())
  const orgIds = new Set(subs.map(s => s.org_id))
  if (opts.newsOrgId) orgIds.add(opts.newsOrgId)
  for (const orgId of orgIds) await withOrg(db, orgId, tx => unsubscribeInSite(tx, userId, opts.capture))
}

// In the current org: the account's subscriptions become unsubscribed, and
// every purpose granted on its contacts' addresses is withdrawn.
export async function unsubscribeInSite(tx: Tx, userId: string, capture: ConsentCapture): Promise<void> {
  const subs = await tx
    .selectFrom('pt_subscription')
    .select(['id', 'status', 'contact_id', 'platform_news_requested_at'])
    .where('user_id', '=', userId)
    .where('anonymized_at', 'is', null)
    .execute()
  for (const sub of subs) {
    if (sub.status !== 'unsubscribed') await setSubscriptionStatus(tx, sub.id, 'unsubscribed')
    if (sub.platform_news_requested_at) await tx.updateTable('pt_subscription').set({ platform_news_requested_at: null }).where('id', '=', sub.id).execute()
  }
  const contacts = await tx.selectFrom('crm_records').select('id').where('user_id', '=', userId).where('record_type', '=', 'contacts').execute()
  const contactIds = [...new Set([...contacts.map(c => c.id), ...subs.flatMap(s => s.contact_id ? [s.contact_id] : [])])]
  if (!contactIds.length) return
  const granted = await tx
    .selectFrom('crm_contact_channels as cc')
    .innerJoin('crm_channel_consents as c', 'c.channel_id', 'cc.channel_id')
    .select(['c.channel_id', 'c.purpose'])
    .distinct()
    .where('cc.record_id', 'in', contactIds)
    .where('c.status', '=', 'opt_in')
    .execute()
  for (const g of granted) await setConsent(tx, g.channel_id, g.purpose, false, capture)
}
