// Signup form requests for an address already confirmed on the site. The form
// is public, so the chosen times wait in `pt_signup_request` until the
// address's owner confirms them from the email link (single use, 7 days).
import type { Tx } from '@prayertools/shared/db/scope'
import type { SignupInput } from '@prayertools/shared/subscriptions'
import { jsonb } from '@prayertools/shared/db/json'
import { hashToken, randomToken } from '@prayertools/shared/tokens'

export const SIGNUP_REQUEST_DAYS = 7

export type SignupRequest = Omit<SignupInput, 'campaign' | 'preVerified'>

// Saves the request, replacing an earlier one for the same campaign, and
// returns the token for the confirm link.
export async function saveSignupRequest(tx: Tx, subscriptionId: string, campaignId: string, request: SignupRequest): Promise<string> {
  await tx.deleteFrom('pt_signup_request').where('subscription_id', '=', subscriptionId).where('campaign_id', '=', campaignId).execute()
  const token = randomToken(24)
  await tx.insertInto('pt_signup_request').values({
    subscription_id: subscriptionId,
    campaign_id: campaignId,
    token_hash: hashToken(token),
    request: jsonb(request),
    expires_at: new Date(Date.now() + SIGNUP_REQUEST_DAYS * 86_400_000)
  }).execute()
  return token
}

// Uses up a confirm link: the request it names, if it has not expired.
export async function takeSignupRequest(tx: Tx, token: string): Promise<{ subscriptionId: string, campaignId: string, request: SignupRequest } | null> {
  const row = await tx.deleteFrom('pt_signup_request').where('token_hash', '=', hashToken(token)).returningAll().executeTakeFirst()
  if (!row || new Date(row.expires_at) < new Date()) return null
  return { subscriptionId: row.subscription_id, campaignId: row.campaign_id, request: row.request as unknown as SignupRequest }
}
