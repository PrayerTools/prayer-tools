// "Notify me when this campaign runs again". A request counts once its owner
// confirms it from the emailed link, or at once when made from a signed-in
// account; the worker then tells them once, when the next run in the
// campaign's series is published. Runs inside the site's org.
import type { Tx } from './db/scope'
import type { CampaignRow } from './subscriptions'
import { linkContactToAccount, type Account } from './accounts'
import { campaignSeries } from './campaigns'
import { markChannelVerified, PURPOSE_SITE_UPDATES, setConsent, upsertContact, type ConsentCapture } from './crm'
import { campaignStatus } from './setup'
import { hashToken, randomToken } from './tokens'

export const NOTIFY_CONFIRM_DAYS = 7

// Saves an unconfirmed request, replacing an earlier unconfirmed one for the
// same campaign, and returns the token for the confirm link. Null when the
// contact already waits, confirmed, for this campaign.
export async function requestNotify(tx: Tx, input: { contactId: string, campaignId: string, language: string }): Promise<string | null> {
  const waiting = await tx
    .selectFrom('pt_notify_request')
    .select(['id', 'confirmed_at'])
    .where('contact_id', '=', input.contactId)
    .where('campaign_id', '=', input.campaignId)
    .where('notified_at', 'is', null)
    .executeTakeFirst()
  if (waiting?.confirmed_at) return null
  const token = randomToken(24)
  if (waiting) {
    await tx.updateTable('pt_notify_request')
      .set({ token_hash: hashToken(token), language: input.language, created_at: new Date() })
      .where('id', '=', waiting.id)
      .execute()
  } else {
    await tx.insertInto('pt_notify_request').values({
      contact_id: input.contactId,
      campaign_id: input.campaignId,
      language: input.language,
      token_hash: hashToken(token)
    }).execute()
  }
  return token
}

// Saves a request confirmed now, confirming an unconfirmed one for the same
// campaign. 'already' when the contact already waits, confirmed, for it.
export async function requestNotifyConfirmed(tx: Tx, input: { contactId: string, campaignId: string, language: string }, now = new Date()): Promise<'confirmed' | 'already'> {
  const waiting = await tx
    .selectFrom('pt_notify_request')
    .select(['id', 'confirmed_at'])
    .where('contact_id', '=', input.contactId)
    .where('campaign_id', '=', input.campaignId)
    .where('notified_at', 'is', null)
    .executeTakeFirst()
  if (waiting?.confirmed_at) return 'already'
  if (waiting) {
    await tx.updateTable('pt_notify_request')
      .set({ confirmed_at: now, token_hash: null, language: input.language })
      .where('id', '=', waiting.id)
      .execute()
    return 'confirmed'
  }
  const added = await tx.insertInto('pt_notify_request').values({
    contact_id: input.contactId,
    campaign_id: input.campaignId,
    language: input.language,
    confirmed_at: now
  })
    .onConflict(oc => oc.columns(['contact_id', 'campaign_id']).where('notified_at', 'is', null).doNothing())
    .returning('id')
    .executeTakeFirst()
  return added ? 'confirmed' : 'already'
}

// A request from a signed-in account with a verified address: the site's
// contact for that address, linked to the account, gets the site-updates
// consent and a request confirmed now. 'closed' when the campaign's page
// offers no request form.
export async function requestNotifyAsAccount(tx: Tx, input: {
  site: { status: string }
  campaign: CampaignRow
  account: Account
  language: string
  consent: ConsentCapture
}, now = new Date()): Promise<'closed' | 'confirmed' | 'already'> {
  const { account } = input
  if (!account.verified || !account.email) throw new Error('requestNotifyAsAccount needs a verified address')
  if (!(await notifyOffer(tx, input.site, input.campaign, now)).form) return 'closed'
  const contact = await upsertContact(tx, { email: account.email, name: account.display_name || null, data: { pt_language: input.language }, source: 'notify form' })
  await markChannelVerified(tx, contact.channelId)
  await linkContactToAccount(tx, contact.contactId, account)
  await setConsent(tx, contact.channelId, PURPOSE_SITE_UPDATES, true, input.consent)
  return await requestNotifyConfirmed(tx, { contactId: contact.contactId, campaignId: input.campaign.id, language: input.language }, now)
}

// Uses up a confirm link. Returns the campaign asked on, or null for an
// unknown, used or expired link.
export async function confirmNotify(tx: Tx, token: string, now = new Date()): Promise<{ campaignId: string } | null> {
  if (!token || token.length > 200) return null
  const row = await tx
    .updateTable('pt_notify_request')
    .set({ confirmed_at: now, token_hash: null })
    .where('token_hash', '=', hashToken(token))
    .where('confirmed_at', 'is', null)
    .where('created_at', '>', new Date(now.getTime() - NOTIFY_CONFIRM_DAYS * 86_400_000))
    .returning('campaign_id')
    .executeTakeFirst()
  return row ? { campaignId: row.campaign_id } : null
}

// The run that answers a request made on `campaignId`, and the run its ended
// page sends people to: the oldest other published campaign of its series
// that is upcoming or running.
export async function nextRun(tx: Tx, campaignId: string, now = new Date()): Promise<CampaignRow | null> {
  const series = await campaignSeries(tx, campaignId)
  if (!series.some(c => c.id === campaignId)) return null
  return series.find(c => c.id !== campaignId && campaignStatus(c, now) !== 'ended') ?? null
}

// What a campaign's page offers once it has ended: the request form while no
// run of its series is open, else that run. Neither on an archived site, nor
// for a draft or a campaign that has not ended.
export async function notifyOffer(tx: Tx, site: { status: string }, campaign: CampaignRow, now = new Date()): Promise<{ form: boolean, running: CampaignRow | null }> {
  if (site.status === 'archived' || !campaign.published_at || campaignStatus(campaign, now) !== 'ended') return { form: false, running: null }
  const running = await nextRun(tx, campaign.id, now)
  return { form: !running, running }
}

// Confirmed requests not yet answered, counted by the campaign asked on.
export async function waitingCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .selectFrom('pt_notify_request')
    .select(['campaign_id', eb => eb.fn.countAll<string>().as('n')])
    .where('confirmed_at', 'is not', null)
    .where('notified_at', 'is', null)
    .groupBy('campaign_id')
    .execute()
  return new Map(rows.map(r => [r.campaign_id, Number(r.n)]))
}
