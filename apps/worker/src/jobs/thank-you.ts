// End-of-campaign thank-you by email (and push when OneSignal is set). The campaign-wide job stores a
// cursor plus the ids sent in the current batch, so a retry never sends twice.
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { primaryEmailOf } from '@prayertools/shared/crm'
import { suppressedAmong } from '@prayertools/shared/email/suppression'
import { logEmails, type EmailLogEntry } from '@prayertools/shared/email/log'
import { loadSiteMailContext, thankYouEmail, type SiteMailContext } from '@prayertools/shared/email/templates'
import { emailT } from '@prayertools/shared/i18n/email'
import { textIn } from '@prayertools/shared/translatable'
import type { CampaignCta, PtCampaignTable, PtSubscriptionTable } from '@prayertools/shared/db/schema'
import type { Selectable } from 'kysely'
import { personLanguage, personLinks, siteMail, siteRow, type SiteRow } from '../mail'
import { mapPool } from '../util'
import { JobDeferred, JobError, requireString, type JobContext } from './registry'

type Campaign = Selectable<PtCampaignTable>
type Sub = Selectable<PtSubscriptionTable>

export const THANK_YOU_BATCH = 100
const SEND_CONCURRENCY = 10

interface Totals { prayers: number, seconds: number }

async function totalsFor(tx: Tx, campaignId: string, subIds: string[]): Promise<Map<string, Totals>> {
  if (subIds.length === 0) return new Map()
  const rows = await tx
    .selectFrom('pt_person_total')
    .select(['subscription_id', 'prayers', 'seconds'])
    .where('campaign_id', '=', campaignId)
    .where('subscription_id', 'in', subIds)
    .execute()
  return new Map(rows.map(r => [r.subscription_id, { prayers: Number(r.prayers), seconds: Number(r.seconds) }]))
}

function renderFor(mctx: SiteMailContext, site: SiteRow, campaign: Campaign, sub: Sub, totals: Totals | undefined, personal: boolean) {
  const lang = personLanguage(sub.language, site)
  const links = personLinks(mctx, sub)
  const cta = (campaign.cta ?? {}) as CampaignCta
  const ctaLabel = textIn(cta.label, lang, site.default_language)
  const message = textIn(campaign.end_message, lang, site.default_language) || null
  const rendered = thankYouEmail(mctx, lang, {
    campaignName: campaign.name,
    personal,
    prayers: totals?.prayers ?? 0,
    minutes: Math.round((totals?.seconds ?? 0) / 60),
    message,
    cta: ctaLabel && cta.url ? { label: ctaLabel, url: cta.url } : null,
    manageUrl: links.manageUrl,
    unsubscribeUrl: links.unsubscribeUrl
  })
  return { rendered, links, lang }
}

function pushText(campaign: Campaign, site: SiteRow, lang: string, siteName: string, personal: boolean) {
  const vars = { site: siteName, campaign: campaign.name }
  return {
    heading: emailT(lang, 'thanks.heading'),
    body: textIn(campaign.end_message, lang, site.default_language) || emailT(lang, personal ? 'thanks.body_personal' : 'thanks.body', vars)
  }
}

async function loadCampaign(tx: Tx, campaignId: string): Promise<{ campaign: Campaign, site: SiteRow, mctx: SiteMailContext, orgId: string }> {
  const campaign = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', campaignId).executeTakeFirst()
  if (!campaign) throw new JobError(`Campaign ${campaignId} not found`, false)
  const site = await siteRow(tx)
  if (!site) throw new JobError('Site not found', false)
  return { campaign, site, mctx: await loadSiteMailContext(tx, campaign.org_id), orgId: campaign.org_id }
}

interface Progress extends Record<string, unknown> {
  cursor: string | null
  batch_sent: string[]
  sent: number
  skipped: number
  push_cursor: string | null
  pushed: number
}

async function thankYou(ctx: JobContext, payload: Record<string, unknown>) {
  const campaignId = requireString(payload, 'campaignId')
  const orgId = ctx.job.org_id
  if (!orgId) throw new JobError('org_id is required', false)
  const saved = await ctx.progress<Progress>()
  const p: Progress = {
    cursor: saved.cursor ?? null,
    batch_sent: saved.batch_sent ?? [],
    sent: saved.sent ?? 0,
    skipped: saved.skipped ?? 0,
    push_cursor: saved.push_cursor ?? null,
    pushed: saved.pushed ?? 0
  }

  for (;;) {
    if (ctx.stopping()) {
      await ctx.saveProgress(p)
      throw new JobDeferred()
    }
    const batch = await withOrg(ctx.app, orgId, async (tx) => {
      const base = await loadCampaign(tx, campaignId)
      let q = tx
        .selectFrom('pt_subscription as s')
        .selectAll('s')
        .where('s.delivery', '=', 'email')
        .where('s.verified_at', 'is not', null)
        .where('s.status', '<>', 'unsubscribed')
        .where('s.anonymized_at', 'is', null)
        .where(eb => eb.exists(eb.selectFrom('pt_commitment as c').select('c.id').whereRef('c.subscription_id', '=', 's.id').where('c.campaign_id', '=', campaignId)))
        .orderBy('s.id')
        .limit(THANK_YOU_BATCH)
      if (p.cursor) q = q.where('s.id', '>', p.cursor)
      const subs = await q.execute()
      const emails = new Map<string, string>()
      for (const s of subs) {
        const e = s.contact_id ? await primaryEmailOf(tx, s.contact_id) : null
        if (e) emails.set(s.id, e.email)
      }
      const suppressed = await suppressedAmong(tx, [...emails.values()])
      const totals = await totalsFor(tx, campaignId, subs.map(s => s.id))
      return { ...base, subs, emails, suppressed, totals }
    })
    if (batch.subs.length === 0) break

    const done = new Set(p.batch_sent)
    const sentLog: EmailLogEntry[] = []
    const results = await mapPool(batch.subs, SEND_CONCURRENCY, async (sub) => {
      if (done.has(sub.id)) return 'already'
      const to = batch.emails.get(sub.id)
      if (!to || batch.suppressed.has(to.trim().toLowerCase())) return 'skipped'
      const { rendered, links } = renderFor(batch.mctx, batch.site, batch.campaign, sub, batch.totals.get(sub.id), false)
      await ctx.sendMail(siteMail(batch.mctx, to, rendered, 'thank_you', links.unsubscribeUrl))
      done.add(sub.id)
      sentLog.push({ subscriptionId: sub.id, kind: 'thank_you', subject: rendered.subject, campaignId })
      return 'sent'
    })
    await withOrg(ctx.app, orgId, tx => logEmails(tx, sentLog))
    let failure: unknown = null
    for (const r of results) {
      if (!r.ok) failure ??= r.error
      else if (r.value === 'sent') p.sent++
      else if (r.value === 'skipped') p.skipped++
    }
    if (failure) {
      p.batch_sent = [...done]
      await ctx.saveProgress(p)
      throw failure
    }
    p.cursor = batch.subs[batch.subs.length - 1]!.id
    p.batch_sent = []
    await ctx.saveProgress(p)
    ctx.log.info('thank_you.batch', { sent: p.sent, skipped: p.skipped })
  }

  if (ctx.push) await pushCampaign(ctx, orgId, campaignId, p)
  return { sent: p.sent, skipped: p.skipped, pushed: p.pushed }
}

// App users of the campaign, grouped by language, one notification per group.
async function pushCampaign(ctx: JobContext, orgId: string, campaignId: string, p: Progress): Promise<void> {
  for (;;) {
    const batch = await withOrg(ctx.app, orgId, async (tx) => {
      const base = await loadCampaign(tx, campaignId)
      let q = tx
        .selectFrom('pt_subscription as s')
        .innerJoin('pt_intercessor_device as d', 'd.intercessor_id', 's.intercessor_id')
        .select(['s.id', 's.language', 'd.push_id'])
        .where('s.delivery', '=', 'app')
        .where('s.status', '<>', 'unsubscribed')
        .where('d.push_id', 'is not', null)
        .where(eb => eb.exists(eb.selectFrom('pt_commitment as c').select('c.id').whereRef('c.subscription_id', '=', 's.id').where('c.campaign_id', '=', campaignId)))
        .orderBy('s.id')
        .limit(500)
      if (p.push_cursor) q = q.where('s.id', '>', p.push_cursor)
      return { ...base, rows: await q.execute() }
    })
    if (batch.rows.length === 0) return
    const byLang = new Map<string, string[]>()
    for (const r of batch.rows) {
      const lang = personLanguage(r.language, batch.site)
      byLang.set(lang, [...(byLang.get(lang) ?? []), r.push_id!])
    }
    for (const [lang, ids] of byLang) {
      const t = pushText(batch.campaign, batch.site, lang, batch.mctx.siteName, false)
      await ctx.push!({ pushIds: ids, heading: t.heading, body: t.body, data: { site: orgId, campaign: campaignId, kind: 'thank_you' } })
      p.pushed += ids.length
    }
    p.push_cursor = batch.rows[batch.rows.length - 1]!.id
    await ctx.saveProgress(p)
  }
}

async function thankYouPerson(ctx: JobContext, payload: Record<string, unknown>) {
  const subscriptionId = requireString(payload, 'subscriptionId')
  const campaignId = requireString(payload, 'campaignId')
  const orgId = ctx.job.org_id
  if (!orgId) throw new JobError('org_id is required', false)
  const done = await ctx.progress<{ email_done: boolean, push_done: boolean }>()
  const work = await withOrg(ctx.app, orgId, async (tx) => {
    const base = await loadCampaign(tx, campaignId)
    const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', subscriptionId).executeTakeFirst()
    if (!sub || sub.status === 'unsubscribed' || sub.anonymized_at) return null
    const totals = await totalsFor(tx, campaignId, [sub.id])
    const email = sub.delivery === 'email' && sub.verified_at && sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
    const suppressed = email ? (await suppressedAmong(tx, [email.email])).size > 0 : false
    const pushIds = sub.delivery === 'app' && sub.intercessor_id
      ? (await tx.selectFrom('pt_intercessor_device').select('push_id').where('intercessor_id', '=', sub.intercessor_id).where('push_id', 'is not', null).execute()).map(d => d.push_id!)
      : []
    return { ...base, sub, totals, email: suppressed ? null : email?.email ?? null, pushIds }
  })
  if (!work) return { skipped: 1 }
  let sent = 0
  let pushed = 0
  if (work.email && !done.email_done) {
    const { rendered, links } = renderFor(work.mctx, work.site, work.campaign, work.sub, work.totals.get(work.sub.id), true)
    await ctx.sendMail(siteMail(work.mctx, work.email, rendered, 'thank_you', links.unsubscribeUrl))
    await ctx.saveProgress({ ...done, email_done: true })
    await withOrg(ctx.app, orgId, tx => logEmails(tx, [{ subscriptionId: work.sub.id, kind: 'thank_you', subject: rendered.subject, campaignId }]))
    sent = 1
  }
  if (work.pushIds.length && ctx.push && !done.push_done) {
    const t = pushText(work.campaign, work.site, personLanguage(work.sub.language, work.site), work.mctx.siteName, true)
    await ctx.push({ pushIds: work.pushIds, heading: t.heading, body: t.body, data: { site: orgId, campaign: campaignId, kind: 'thank_you' } })
    pushed = work.pushIds.length
  }
  return { sent, pushed }
}

export const thankYouHandlers = { thank_you: thankYou, thank_you_person: thankYouPerson }
