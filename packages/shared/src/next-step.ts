// What the end of a campaign points its intercessors to, for the thank-you
// email and the ended page alike: the champion's own button, or for a side
// campaign an invitation to the site's main campaign. The invitation is
// resolved here each time and never stored.
import { sql } from 'kysely'
import type { Tx } from './db/scope'
import type { CampaignCta, CampaignKind, TranslatableText } from './db/schema'
import { isSideCampaign, pickCurrentCampaign, type CampaignLike } from './setup'
import { sitePath } from './paths'
import { textIn } from './translatable'

export type NextStep =
  | { kind: 'cta', label: string, url: string }
  // Invitation to the main campaign; `path` is its signup page on the site.
  | { kind: 'join', campaign: string, path: string }
  // The person already has prayer times in the main campaign.
  | { kind: 'praying', campaign: string }

interface EndedCampaign {
  kind?: CampaignKind | null
  cta?: unknown
}

function ctaOf(c: EndedCampaign): CampaignCta {
  return (c.cta ?? {}) as CampaignCta
}

// The main campaign a side campaign's end invites people to: running or open
// for signup, unless the champion set their own button or none.
export function nextStepCampaign<T extends CampaignLike & { name: string }>(campaign: EndedCampaign, campaigns: T[], now: Date = new Date()): T | null {
  const cta = ctaOf(campaign)
  if (!isSideCampaign(campaign) || cta.url || cta.mode === 'none') return null
  const current = pickCurrentCampaign(campaigns, now)
  return current && current.state !== 'between' ? current.campaign : null
}

// `main` comes from `nextStepCampaign`; `praying` says whether the person has
// prayer times running in it.
export function nextStep(campaign: EndedCampaign, main: { name: string } | null, o: { lang: string, defaultLang: string, praying: boolean }): NextStep | null {
  const cta = ctaOf(campaign)
  if (cta.mode === 'none') return null
  if (cta.url) return { kind: 'cta', label: textIn(cta.label as TranslatableText | undefined, o.lang, o.defaultLang), url: cta.url }
  if (!main || !isSideCampaign(campaign)) return null
  if (o.praying) return { kind: 'praying', campaign: main.name }
  return { kind: 'join', campaign: main.name, path: sitePath({ lang: o.lang, defaultLang: o.defaultLang, page: 'signup' }) }
}

// Those of `subscriptionIds` whose person has prayer times still running in
// the campaign, on that subscription or another one of the same account.
export async function prayingIn(tx: Tx, campaignId: string, subscriptionIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (subscriptionIds.length === 0) return new Set()
  const rows = await tx
    .selectFrom('pt_subscription as s')
    .select('s.id')
    .where('s.id', 'in', subscriptionIds)
    .where(eb => eb.exists(eb
      .selectFrom('pt_commitment as c')
      .innerJoin('pt_subscription as o', 'o.id', 'c.subscription_id')
      .select('c.id')
      .where('c.campaign_id', '=', campaignId)
      .where('c.finished_at', 'is', null)
      .where(sql<boolean>`(c.ends_on IS NULL OR c.ends_on >= (${now.toISOString()}::timestamptz AT TIME ZONE c.timezone)::date)`)
      .where('o.status', '<>', 'unsubscribed')
      .where('o.anonymized_at', 'is', null)
      .where(sql<boolean>`(o.id = s.id OR (s.user_id IS NOT NULL AND o.user_id = s.user_id))`)
    ))
    .execute()
  return new Set(rows.map(r => r.id))
}
