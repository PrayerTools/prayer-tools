// Changes a person makes to their own subscription, from the manage page or
// My prayer. Every function runs inside the subscription's org.
import type { Tx } from '@prayertools/shared/db/scope'
import { insertCommitment, refreshReminders, setSubscriptionStatus, updateCommitment, validateRuleForCampaign, type CampaignRow, type SubscriptionRow } from '@prayertools/shared/subscriptions'
import { campaignStatus, defaultDuration, pickCurrentCampaign } from '@prayertools/shared/setup'
import { campaignById, loadCampaigns } from '@prayertools/shared/campaigns'
import { customPurpose, primaryEmailOf, PURPOSE_SITE_UPDATES, setConsent, type ConsentCapture } from '@prayertools/shared/crm'
import { isValidTimezone } from '@prayertools/shared/dates'
import { siteSettings } from '@prayertools/shared/site'
import { jsonb } from '@prayertools/shared/db/json'
import { parseRuleInput } from '../lib/input'
import { bad } from './request'

async function campaignOf(tx: Tx, id: string): Promise<CampaignRow> {
  const campaign = await campaignById(tx, id)
  if (!campaign) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return campaign
}

export async function addCommitment(tx: Tx, sub: SubscriptionRow, campaignId: string | null, raw: unknown): Promise<void> {
  if (sub.status === 'unsubscribed') bad('unsubscribed')
  const campaign = campaignId ? await campaignOf(tx, campaignId) : pickCurrentCampaign(await loadCampaigns(tx))?.campaign
  if (!campaign || campaignStatus(campaign) === 'ended') bad('closed')
  const rule = parseRuleInput(raw)
  if (!rule) bad('commitment')
  if (rule.duration_min === null && campaign.goal !== 'people') {
    const site = await tx.selectFrom('pt_site').select('settings').executeTakeFirstOrThrow()
    rule.duration_min = defaultDuration(campaign, siteSettings(site.settings).default_duration_min)
  }
  if (validateRuleForCampaign(rule, campaign).length) bad('commitment')
  await insertCommitment(tx, sub, campaign, rule)
}

export async function patchCommitment(tx: Tx, sub: SubscriptionRow, id: string, raw: Record<string, unknown>): Promise<void> {
  const existing = await tx.selectFrom('pt_commitment').selectAll().where('id', '=', id).where('subscription_id', '=', sub.id).executeTakeFirst()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (typeof raw.paused === 'boolean' && Object.keys(raw).length === 1) {
    await updateCommitment(tx, sub, id, { paused: raw.paused })
    return
  }
  const rule = parseRuleInput({ ...raw, kind: existing.kind })
  if (!rule || existing.kind !== 'recurring') bad('commitment')
  const campaign = await campaignOf(tx, existing.campaign_id)
  if (validateRuleForCampaign(rule, campaign).length) bad('commitment')
  await updateCommitment(tx, sub, id, {
    frequency: rule.frequency,
    days_of_week: rule.days_of_week,
    time: rule.time,
    duration_min: rule.duration_min,
    ...(typeof raw.paused === 'boolean' ? { paused: raw.paused } : {})
  })
}

export async function removeCommitment(tx: Tx, sub: SubscriptionRow, id: string): Promise<void> {
  const res = await tx.deleteFrom('pt_commitment').where('id', '=', id).where('subscription_id', '=', sub.id).executeTakeFirst()
  if (!Number(res.numDeletedRows)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

// A new name on a subscription linked to an account renames the account;
// the caller copies it to the person's other sites (returned user id).
export async function updateProfile(tx: Tx, sub: SubscriptionRow, input: { name?: unknown, language?: unknown, timezone?: unknown }, siteLanguages: string[]): Promise<string | null> {
  const patch: { language?: string, timezone?: string, updated_at: Date } = { updated_at: new Date() }
  if (typeof input.language === 'string' && input.language !== sub.language) {
    if (!siteLanguages.includes(input.language)) bad('language')
    patch.language = input.language
  }
  if (typeof input.timezone === 'string' && input.timezone !== sub.timezone) {
    if (!isValidTimezone(input.timezone)) bad('timezone')
    patch.timezone = input.timezone
  }
  await tx.updateTable('pt_subscription').set(patch).where('id', '=', sub.id).execute()
  if (patch.timezone) {
    // Reminders stay at the same local time in the new zone.
    await tx.updateTable('pt_commitment').set({ timezone: patch.timezone, updated_at: new Date() }).where('subscription_id', '=', sub.id).where('kind', '=', 'recurring').execute()
    await refreshReminders(tx, sub.id)
  }
  if (sub.contact_id) {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 200) : null
    const contact = await tx.selectFrom('crm_records').select(['data']).where('id', '=', sub.contact_id).executeTakeFirst()
    if (contact) {
      const data = { ...(contact.data as Record<string, unknown>), ...(patch.language ? { pt_language: patch.language } : {}) }
      await tx.updateTable('crm_records').set({ ...(name ? { name } : {}), data: jsonb(data), updated_at: new Date() }).where('id', '=', sub.contact_id).execute()
    }
    if (name && sub.user_id) {
      await tx.updateTable('users').set({ display_name: name, updated: new Date() }).where('id', '=', sub.user_id).execute()
      return sub.user_id
    }
  }
  return null
}

export async function setSubscriptionConsent(tx: Tx, sub: SubscriptionRow, purpose: unknown, grant: unknown, capture: Omit<ConsentCapture, 'wording'>): Promise<void> {
  if (typeof purpose !== 'string' || typeof grant !== 'boolean') bad('consent')
  let wording: ConsentCapture['wording'] = { key: 'consent.site_updates' }
  if (purpose !== PURPOSE_SITE_UPDATES) {
    const key = purpose.startsWith('custom:') ? purpose.slice(7) : ''
    const option = key ? await tx.selectFrom('pt_consent_option').select(['key', 'label']).where('key', '=', key).where('active', '=', true).executeTakeFirst() : null
    if (!option) bad('consent')
    const label = option.label as { values: Record<string, string>, source: string }
    wording = { label: label.values[sub.language] || label.values[label.source] || key }
    purpose = customPurpose(key)
  }
  const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
  if (!email) bad('consent')
  await setConsent(tx, email.channelId, purpose as string, grant, { ...capture, wording, language: sub.language })
}

export async function setOwnStatus(tx: Tx, sub: SubscriptionRow, status: unknown): Promise<void> {
  if (status !== 'active' && status !== 'unsubscribed') bad('status')
  if (sub.status === status) return
  await setSubscriptionStatus(tx, sub.id, status)
}

