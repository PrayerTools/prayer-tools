// Web signup: creates or reuses the site's CRM contact, a subscription and
// commitments in the campaign, grants the ticked consents and sends the
// verification email. Google / Apple sign-in arrives already verified and gets
// the welcome email instead.
import { withOrg } from '@prayertools/shared/db/scope'
import { createWebSignup, validateRuleForCampaign, type RuleInput } from '@prayertools/shared/subscriptions'
import { findContactByEmail, normalizeEmail } from '@prayertools/shared/crm'
import { isValidTimezone } from '@prayertools/shared/dates'
import { defaultDuration } from '@prayertools/shared/setup'
import { recordEvent } from '@prayertools/shared/stats'
import { textIn } from '@prayertools/shared/translatable'
import { manageUrl } from '@prayertools/shared/links'
import { manageLinkEmail, verificationEmail } from '@prayertools/shared/email/templates'
import type { TranslatableText, SignupFieldKind } from '@prayertools/shared/db/schema'
import { useDb, ensureSystemUserOnce } from '../utils/db'
import { bad, background, clientIp, limit, readJson, requireTurnstile, str } from '../utils/request'
import { siteContext } from '../utils/site-context'
import { loadSiteData, stateOf } from '../utils/site-data'
import { parseAnswers, parseRuleInput } from '../lib/input'
import { verifiedEmailFromIdToken } from '../utils/id-token'
import { deliver, prepareSiteMail, type PendingMail } from '../utils/mail'
import { grantPlatformNews } from '../utils/staff'
import { forwardInBackground } from '../utils/analytics'
import { prepareWelcomeMail } from '../utils/welcome'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  limit(event, 'signup', 6, 60_000)
  limit(event, 'signup-hour', 40, 3_600_000)
  const body = await readJson(event)
  await requireTurnstile(event, body.turnstile)

  let email = str(body.email, 254)
  let preVerified = false
  const idToken = body.id_token as { provider?: unknown, token?: unknown } | null | undefined
  if (idToken && typeof idToken === 'object') {
    const verified = await verifiedEmailFromIdToken(idToken.provider, idToken.token)
    if (!verified) bad('id_token')
    email = verified
    preVerified = true
  }
  const { normalized, valid } = normalizeEmail(email)
  if (!valid) bad('email')
  const timezone = str(body.timezone, 64)
  if (!isValidTimezone(timezone)) bad('timezone')
  const name = str(body.name, 200) || null
  const rawCommitments = Array.isArray(body.commitments) ? body.commitments.slice(0, 10) : []
  if (!rawCommitments.length) bad('commitments')
  const consents = (body.consents ?? {}) as { site_updates?: unknown, platform_news?: unknown, custom?: unknown }
  const capture = { surface: 'web_signup', source: ctx.host, ip: clientIp(event), userAgent: getRequestHeader(event, 'user-agent') ?? null }

  await ensureSystemUserOnce()
  const result = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const data = await loadSiteData(tx)
    if (data.site.status === 'archived') bad('closed')
    const wanted = str(body.campaign, 40)
    const campaign = wanted ? data.campaigns.find(c => c.slug === wanted || c.id === wanted) : data.current?.campaign
    if (!campaign) bad('closed')
    const state = stateOf(data, campaign)
    if (state !== 'active' && state !== 'upcoming') bad('closed')
    const language = data.site.languages.includes(str(body.language, 10)) ? str(body.language, 10) : data.site.default_language

    const commitments: RuleInput[] = []
    for (const raw of rawCommitments) {
      const rule = parseRuleInput(raw)
      if (!rule) bad('commitment')
      if (rule.duration_min === null && campaign.goal !== 'people') rule.duration_min = defaultDuration(campaign, data.settings.default_duration_min)
      if (validateRuleForCampaign(rule, campaign).length) bad('commitment')
      commitments.push(rule)
    }

    const fields = await tx.selectFrom('pt_signup_field').select(['key', 'kind', 'required', 'options']).execute()
    const { answers, missing } = parseAnswers(fields.map(f => ({ key: f.key, kind: f.kind as SignupFieldKind, required: f.required, options: (f.options ?? []) as { key: string }[] })), body.answers)
    if (missing.length) bad('required_field')

    const options = await tx.selectFrom('pt_consent_option').select(['key', 'label']).where('active', '=', true).execute()
    const wantedCustom = Array.isArray(consents.custom) ? consents.custom.filter((k): k is string => typeof k === 'string') : []
    const custom = options.filter(o => wantedCustom.includes(o.key))
    const consentLabels = Object.fromEntries(custom.map(o => [o.key, textIn(o.label as TranslatableText, language, data.site.default_language)]))

    // An address already verified on this site never gets commitments or a
    // reactivation from a form anyone can fill in: it gets its manage link.
    if (!preVerified) {
      const existing = await findContactByEmail(tx, normalized)
      const sub = existing ? await tx.selectFrom('pt_subscription').selectAll().where('contact_id', '=', existing.contactId).executeTakeFirst() : null
      if (sub?.verified_at) {
        const mail = await prepareSiteMail(tx, ctx.orgId, normalized, 'manage_link', m => manageLinkEmail(m, sub.language, manageUrl(m.siteUrl, ctx.orgId, sub.id, sub.manage_version)))
        return { known: true as const, mail }
      }
    }

    const res = await createWebSignup(tx, {
      campaign,
      email: normalized,
      name,
      language,
      timezone,
      commitments,
      consents: { siteUpdates: consents.site_updates === true, custom: custom.map(o => o.key) },
      consentLabels,
      answers,
      referredBy: str(body.referral, 20) || null,
      joinedFrom: str(body.from, 100) || null,
      preVerified,
      capture: { ...capture, language }
    })
    const frequency = commitments.map(c => c.kind === 'dates' ? 'dates' : c.frequency).join(',')
    if (res.newSubscription) {
      await recordEvent(tx, { campaignId: campaign.id, type: 'campaign_signup', source: res.subscription.referred_by ? 'share' : null, meta: { frequency, subscription_id: res.subscription.id } })
    }
    let mail: PendingMail | null = null
    if (res.verifyToken) {
      const token = res.verifyToken
      mail = await prepareSiteMail(tx, ctx.orgId, normalized, 'verify', m => verificationEmail(m, language, `${m.siteUrl}/verify/${token}`))
    } else if (res.verifiedNow) {
      mail = await prepareWelcomeMail(tx, ctx.orgId, res.subscription)
    }
    if (preVerified && res.newSubscription) {
      await recordEvent(tx, { campaignId: campaign.id, type: 'campaign_signup_verified', meta: { subscription_id: res.subscription.id } })
    }
    return { known: false as const, res, mail, campaign, language, frequency }
  })

  background(event, deliver(result.mail))
  if (consents.platform_news === true) {
    background(event, grantPlatformNews(normalized, name, { ...capture, language: str(body.language, 10) || undefined }))
  }
  if (result.known) return { ok: true, verify: true, referral_code: null }

  const { res, campaign } = result
  if (res.newSubscription) {
    forwardInBackground(event, { orgId: ctx.orgId, slug: ctx.slug, host: ctx.host }, {
      event_type: 'campaign_signup',
      email: normalized,
      language: result.language,
      campaignId: campaign.id,
      metadata: { frequency: result.frequency, referral_source: res.subscription.referred_by ? 'share' : null, joined_from: res.subscription.joined_from, subscription_id: res.subscription.id }
    })
    if (preVerified) {
      forwardInBackground(event, { orgId: ctx.orgId, slug: ctx.slug, host: ctx.host }, { event_type: 'campaign_signup_verified', email: normalized, campaignId: campaign.id, metadata: { subscription_id: res.subscription.id } })
    }
  }
  return { ok: true, verify: !res.subscription.verified_at, referral_code: res.newSubscription ? res.subscription.referral_code : null }
})

