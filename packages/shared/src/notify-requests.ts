// "Notify me when this campaign runs again". A request counts once its owner
// confirms it from the emailed link; the worker then tells them once, when
// the next run in the campaign's series is published. Runs inside the site's org.
import type { Tx } from './db/scope'
import type { CampaignRow } from './subscriptions'
import { campaignSeries } from './campaigns'
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

// The run that answers a request made on `campaignId`: the first published
// campaign of its series created after it that has not ended.
export async function nextRun(tx: Tx, campaignId: string, now = new Date()): Promise<CampaignRow | null> {
  const series = await campaignSeries(tx, campaignId)
  const at = series.findIndex(c => c.id === campaignId)
  if (at < 0) return null
  return series.slice(at + 1).find(c => campaignStatus(c, now) !== 'ended') ?? null
}
