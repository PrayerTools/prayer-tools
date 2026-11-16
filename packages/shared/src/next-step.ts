// What the end of a campaign points its intercessors to, for the thank-you
// email and the ended page alike: the champion's own button, or an invitation
// to the campaign it hands on to (see `handOnCampaign`). The invitation is
// resolved here each time and never stored.
import { sql } from 'kysely'
import type { Tx } from './db/scope'
import type { CampaignCta, CampaignKind, TranslatableText } from './db/schema'
import { handOnCampaign, pickCurrentCampaign, type CampaignLike } from './setup'
import { campaignSegment } from './campaigns'
import { sitePath } from './paths'
import { textIn } from './translatable'

export type NextStep =
  | { kind: 'cta', label: string, url: string }
  // Invitation to the next campaign; `path` is its signup page on the site.
  | { kind: 'join', campaign: string, path: string }
  // The person already has prayer times in the next campaign.
  | { kind: 'praying', campaign: string }

// The campaign an ended one invites people to. `segment` is its address on
// the site, null when it is the site's current campaign at the root.
export interface NextCampaign {
  id: string
  name: string
  segment: string | null
}

interface EndedCampaign {
  id?: string
  slug?: string
  kind?: CampaignKind | null
  template_key?: string | null
  start_date?: string | null
  cta?: unknown
}

function ctaOf(c: EndedCampaign): CampaignCta {
  return (c.cta ?? {}) as CampaignCta
}

// The campaign an ended one invites people to, unless the champion set their
// own button or none.
export function nextStepCampaign<T extends CampaignLike & { name: string, slug: string }>(campaign: EndedCampaign, campaigns: T[], now: Date = new Date()): NextCampaign | null {
  const cta = ctaOf(campaign)
  if (cta.url || cta.mode === 'none') return null
  const next = handOnCampaign(campaign, campaigns, now)
  if (!next) return null
  return { id: next.id, name: next.name, segment: campaignSegment(next, pickCurrentCampaign(campaigns, now)?.campaign.id) }
}

// `next` comes from `nextStepCampaign`; `praying` says whether the person has
// prayer times running in it. The signup link names the ended campaign, so
// the signup records where the person joined from.
export function nextStep(campaign: EndedCampaign, next: NextCampaign | null, o: { lang: string, defaultLang: string, praying: boolean }): NextStep | null {
  const cta = ctaOf(campaign)
  if (cta.mode === 'none') return null
  if (cta.url) return { kind: 'cta', label: textIn(cta.label as TranslatableText | undefined, o.lang, o.defaultLang), url: cta.url }
  if (!next) return null
  if (o.praying) return { kind: 'praying', campaign: next.name }
  const from = campaign.slug ? `?from=${encodeURIComponent(campaign.slug)}` : ''
  return { kind: 'join', campaign: next.name, path: sitePath({ lang: o.lang, defaultLang: o.defaultLang, campaignSlug: next.segment, page: 'signup' }) + from }
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
