// Link targets that act and then redirect: manage links, email verification,
// check-in answers, draft previews and the WordPress-era URL shapes.
import type { H3Event } from 'h3'
import { withOrg } from '@prayertools/shared/db/scope'
import { parseLink, personalToken } from '@prayertools/shared/links'
import { hashToken } from '@prayertools/shared/tokens'
import { recordActivity, setSubscriptionStatus, verifySubscription } from '@prayertools/shared/subscriptions'
import { primaryEmailOf } from '@prayertools/shared/crm'
import { recordEvent } from '@prayertools/shared/stats'
import { sitePath } from '@prayertools/shared/paths'
import { campaignStatus } from '@prayertools/shared/setup'
import type { CheckinResponse } from '@prayertools/shared/db/schema'
import { useDb } from './db'
import type { SiteContext } from './site-context'
import { setManageCookie, setPreviewCookie } from './cookies'
import { forwardInBackground } from './analytics'
import { deliver } from './mail'
import { background } from './request'
import { prepareWelcomeMail } from './welcome'
import { loadSiteData } from './site-data'

// Renders another page path in place of the requested one.
export function rewriteView(event: H3Event, path: string, status = 200): void {
  event.context.viewPath = path
  event.context.viewStatus = status
}

export async function exchangeManageLink(event: H3Event, ctx: SiteContext, token: string) {
  const link = parseLink(token, 'm')
  if (!link || link.expired || link.orgId !== ctx.orgId) return
  const sub = await withOrg(useDb(), ctx.orgId, tx => tx.selectFrom('pt_subscription').select(['id', 'manage_version']).where('id', '=', link.subscriptionId).executeTakeFirst())
  if (!sub || sub.manage_version !== link.version) return
  setManageCookie(event, ctx.orgId, sub.id, sub.manage_version)
  return sendRedirect(event, '/manage', 302)
}

export async function verifyLink(event: H3Event, ctx: SiteContext, token: string) {
  const result = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const before = await tx.selectFrom('pt_subscription').select(['id', 'verified_at']).where('verify_token_hash', '=', hashToken(token)).executeTakeFirst()
    if (!before) return null
    const sub = await verifySubscription(tx, token)
    if (!sub) return null
    const data = await loadSiteData(tx)
    const latest = await tx.selectFrom('pt_commitment').select('campaign_id').where('subscription_id', '=', sub.id).orderBy('created_at', 'desc').executeTakeFirst()
    const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
    const firstTime = !before.verified_at
    if (firstTime) await recordEvent(tx, { campaignId: latest?.campaign_id ?? null, type: 'campaign_signup_verified', meta: { subscription_id: sub.id } })
    const welcome = firstTime ? await prepareWelcomeMail(tx, ctx.orgId, sub) : null
    const campaign = data.campaigns.find(c => c.id === latest?.campaign_id)
    const upcoming = campaign && campaignStatus(campaign) === 'upcoming'
      ? { slug: data.current?.campaign.id === campaign.id ? null : campaign.slug }
      : null
    return { sub, defaultLanguage: data.site.default_language, campaignId: latest?.campaign_id ?? null, email: email?.email ?? null, firstTime, welcome, upcoming }
  })
  if (!result) return
  const { sub } = result
  setManageCookie(event, ctx.orgId, sub.id, sub.manage_version)
  if (result.firstTime) {
    background(event, deliver(result.welcome))
    forwardInBackground(event, { orgId: ctx.orgId, slug: ctx.slug, host: ctx.host }, {
      event_type: 'campaign_signup_verified',
      email: result.email,
      language: sub.language,
      campaignId: result.campaignId,
      metadata: { subscription_id: sub.id }
    })
  }
  // A campaign that has not started yet has nothing to pray, so its subscribers land on its signup page.
  const path = result.upcoming
    ? sitePath({ lang: sub.language, defaultLang: result.defaultLanguage, campaignSlug: result.upcoming.slug, page: 'signup' })
    : sitePath({ lang: sub.language, defaultLang: result.defaultLanguage, page: 'pray' })
  return sendRedirect(event, `${path}?confirmed=1`, 302)
}

const ANSWERS: CheckinResponse[] = ['yes', 'sometimes', 'no']

export async function checkinAnswer(event: H3Event, ctx: SiteContext, token: string, answer: string) {
  if (!ANSWERS.includes(answer as CheckinResponse)) return sendRedirect(event, '/notice/link_invalid', 302)
  const ok = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const checkin = await tx.selectFrom('pt_checkin').select(['id', 'subscription_id']).where('token_hash', '=', hashToken(token)).executeTakeFirst()
    if (!checkin) return false
    const now = new Date()
    await tx.updateTable('pt_checkin').set({ response: answer as CheckinResponse, responded_at: now }).where('id', '=', checkin.id).execute()
    const sub = await tx.selectFrom('pt_subscription').select(['status']).where('id', '=', checkin.subscription_id).executeTakeFirst()
    if (!sub) return false
    if (answer === 'no') {
      if (sub.status !== 'unsubscribed') await setSubscriptionStatus(tx, checkin.subscription_id, 'unsubscribed')
    } else {
      await tx.updateTable('pt_subscription').set({ checkin_cycle_started_at: now, last_activity_at: now, updated_at: now }).where('id', '=', checkin.subscription_id).execute()
      if (sub.status === 'inactive') await recordActivity(tx, checkin.subscription_id)
    }
    return true
  })
  return sendRedirect(event, ok ? `/notice/checkin_${answer}` : '/notice/link_invalid', 302)
}

export async function previewLink(event: H3Event, ctx: SiteContext, token: string) {
  const row = await withOrg(useDb(), ctx.orgId, tx => tx.selectFrom('pt_site').select('preview_token_hash').executeTakeFirst())
  if (!row?.preview_token_hash || row.preview_token_hash !== hashToken(token)) return false
  setPreviewCookie(event, ctx.orgId, row.preview_token_hash)
  await sendRedirect(event, '/', 302)
  return true
}

export async function legacySubscription(orgId: string, kind: 'manage' | 'fuel' | 'ics', key: string): Promise<{ id: string, manage_version: number } | null> {
  if (!key) return null
  const legacy = await useDb()
    .selectFrom('pt_legacy_key')
    .select('subscription_id')
    .where('org_id', '=', orgId)
    .where('kind', '=', kind)
    .where('key_hash', '=', hashToken(key))
    .executeTakeFirst()
  if (!legacy?.subscription_id) return null
  const subId = legacy.subscription_id
  const sub = await withOrg(useDb(), orgId, tx => tx.selectFrom('pt_subscription').select(['id', 'manage_version']).where('id', '=', subId).executeTakeFirst())
  return sub ?? null
}

export async function legacyManage(event: H3Event, ctx: SiteContext, key: string) {
  const sub = await legacySubscription(ctx.orgId, 'manage', key)
  if (!sub) return rewriteView(event, '/notice/link_invalid', 404)
  setManageCookie(event, ctx.orgId, sub.id, sub.manage_version)
  return sendRedirect(event, '/manage', 302)
}

// `/…/prayer/fuel/<day or key>` and any other `fuel` URL → prayer content.
export async function legacyFuel(event: H3Event, ctx: SiteContext, segments: string[], languages: string[], campaignSlugs: string[]) {
  const at = segments.indexOf('fuel')
  const before = segments.slice(0, at).filter(s => s !== 'prayer')
  const prefix = before.filter(s => languages.includes(s) || campaignSlugs.includes(s))
  const after = segments[at + 1] ?? ''
  const base = `/${[...prefix, 'pray'].join('/')}`
  if (/^\d{1,4}$/.test(after)) return sendRedirect(event, `${base}/${Number(after)}`, 301)
  if (after) {
    const sub = await legacySubscription(ctx.orgId, 'fuel', after)
    if (sub) return sendRedirect(event, `${base}#p=${personalToken(ctx.orgId, sub.id)}`, 302)
  }
  return sendRedirect(event, base, 301)
}

// Unsubscribe: the confirm form on /u/<token> and RFC 8058 one-click
// (`List-Unsubscribe=One-Click`) from mail clients. Handled in middleware so
// GET /u/<token> still renders the confirm page.
export async function unsubscribePost(event: H3Event, ctx: SiteContext, token: string) {
  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const oneClick = raw.includes('List-Unsubscribe=One-Click')
  const link = parseLink(token, 'u')
  let ok = false
  if (link && link.orgId === ctx.orgId) {
    ok = await withOrg(useDb(), ctx.orgId, async (tx) => {
      const sub = await tx.selectFrom('pt_subscription').select(['id', 'status']).where('id', '=', link.subscriptionId).executeTakeFirst()
      if (!sub) return false
      if (sub.status !== 'unsubscribed') await setSubscriptionStatus(tx, sub.id, 'unsubscribed')
      return true
    })
  }
  if (oneClick) {
    setResponseStatus(event, ok ? 200 : 404)
    setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
    return ok ? 'Unsubscribed' : 'Not found'
  }
  return sendRedirect(event, ok ? '/notice/unsubscribed' : '/notice/link_invalid', 303)
}
