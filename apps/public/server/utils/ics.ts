// Calendar feeds for a subscription: the webcal feed of upcoming prayer
// times and a one-off file per commitment. Runs inside the site's org.
import type { Tx } from '@prayertools/shared/db/scope'
import { occurrences, entryNumber } from '@prayertools/shared/schedule'
import { localDateOf } from '@prayertools/shared/dates'
import { ruleOf, type CampaignRow, type CommitmentRow, type SubscriptionRow } from '@prayertools/shared/subscriptions'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { campaignSegment, loadCampaigns } from '@prayertools/shared/campaigns'
import { prayUrl } from '@prayertools/shared/links'
import { emailT } from '@prayertools/shared/i18n/email'
import { buildCalendar, type IcsEvent } from '../lib/ics'
import type { SiteContext } from './site-context'

const FEED_DAYS = 60
const MAX_EVENTS = 500

async function context(tx: Tx) {
  const site = await tx.selectFrom('pt_site').select(['default_language', 'settings']).executeTakeFirstOrThrow()
  const campaigns = await loadCampaigns(tx)
  const current = pickCurrentCampaign(campaigns)?.campaign.id ?? null
  const defaultMinutes = Number((site.settings as Record<string, unknown>)?.default_duration_min) || 15
  return { site, campaigns, current, defaultMinutes }
}

function eventsFor(ctx: SiteContext, sub: SubscriptionRow, c: CommitmentRow, campaign: CampaignRow, env: Awaited<ReturnType<typeof context>>, from: Date, to: Date): IcsEvent[] {
  const rule = ruleOf(c)
  const lang = sub.language
  const summary = emailT(lang, 'reminder.subject', { campaign: campaign.name, site: ctx.name })
  return occurrences(rule, from, to).map((at) => {
    const anchor = campaign.start_mode === 'date' && campaign.start_date ? campaign.start_date : rule.starts_on
    const day = entryNumber(anchor, campaign.cadence, localDateOf(at, campaign.start_mode === 'date' ? campaign.timezone : rule.timezone))
    const url = prayUrl(ctx.canonicalOrigin, campaignSegment(campaign, env.current), day > 0 ? day : null, lang === env.site.default_language ? null : lang, ctx.orgId, sub.id)
    return {
      uid: `${c.id}-${at.getTime()}@prayer.tools`,
      start: at,
      minutes: c.duration_min ?? env.defaultMinutes,
      summary,
      description: `${emailT(lang, 'reminder.body', { campaign: campaign.name })}\n${url}`,
      url
    }
  })
}

export async function subscriptionFeed(tx: Tx, ctx: SiteContext, sub: SubscriptionRow): Promise<string> {
  const env = await context(tx)
  const now = new Date()
  const to = new Date(now.getTime() + FEED_DAYS * 86_400_000)
  const events: IcsEvent[] = []
  if (sub.status === 'active') {
    const rows = await tx.selectFrom('pt_commitment').selectAll().where('subscription_id', '=', sub.id).where('paused', '=', false).execute()
    for (const c of rows) {
      const campaign = env.campaigns.find(x => x.id === c.campaign_id)
      if (campaign) events.push(...eventsFor(ctx, sub, c, campaign, env, now, to))
    }
  }
  events.sort((a, b) => a.start.getTime() - b.start.getTime())
  return buildCalendar(ctx.name, events.slice(0, MAX_EVENTS), now)
}

export async function commitmentIcs(tx: Tx, ctx: SiteContext, sub: SubscriptionRow, commitmentId: string): Promise<string | null> {
  const c = await tx.selectFrom('pt_commitment').selectAll().where('id', '=', commitmentId).where('subscription_id', '=', sub.id).executeTakeFirst()
  if (!c) return null
  const env = await context(tx)
  const campaign = env.campaigns.find(x => x.id === c.campaign_id)
  if (!campaign) return null
  const now = new Date()
  const to = new Date(now.getTime() + 90 * 86_400_000)
  return buildCalendar(ctx.name, eventsFor(ctx, sub, c, campaign, env, now, to).slice(0, 120), now)
}
