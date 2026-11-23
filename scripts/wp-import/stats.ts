// WordPress history → v3 daily stats: prayer sessions from the network's
// `wp_praying` counter, group prayer counts and 2023's "I prayed" rows from
// `dt_reports`, and a signup (plus a verification once confirmed) for each
// subscription. Each lands on its day in the campaign whose dates hold it,
// or on the site when none does.
import type { SQL } from 'bun'
import type { Tx } from '@prayertools/shared/db/scope'
import { localDateOf } from '@prayertools/shared/dates'
import { bumpStat, type Metric } from '@prayertools/shared/stats'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import { first, metaOf, postsOf, table, tableExists, wpDate } from './wp'

export interface StatCounts { prayers: number, groupPrayers: number, signups: number, verifications: number }

// `wp_praying.site` is the page origin of each "praying together" call, by host.
export async function loadPraying(wp: SQL): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  const rows = await wp.unsafe('SELECT site, time FROM wp_praying') as { site: string, time: number }[]
  for (const r of rows) {
    let host: string
    try { host = new URL(r.site).hostname.toLowerCase() } catch { continue }
    const list = out.get(host) ?? []
    list.push(Number(r.time))
    out.set(host, list)
  }
  return out
}

function campaignOn(day: string, campaigns: CampaignRow[]): CampaignRow | null {
  const holds = (c: CampaignRow) => {
    const end = (c.end_date as string | null) ?? (c.ended_at ? localDateOf(new Date(c.ended_at), c.timezone) : '9999-12-31')
    return (c.start_date as string) <= day && day <= end
  }
  return campaigns.find(c => !c.kind && holds(c)) ?? campaigns.find(holds) ?? null
}

export async function importStats(wp: SQL, blogId: number, tx: Tx, input: {
  campaigns: Map<number, CampaignRow>
  hosts: string[]
  praying: Map<string, number[]>
  timezone: string
}): Promise<StatCounts> {
  const counts: StatCounts = { prayers: 0, groupPrayers: 0, signups: 0, verifications: 0 }
  const all = [...input.campaigns.values()]
  const totals = new Map<string, number>()
  const add = (campaign: CampaignRow | null, day: string, metric: Metric, by: number) => {
    const key = `${campaign?.id ?? ''}|${day}|${metric}`
    totals.set(key, (totals.get(key) ?? 0) + by)
  }
  // The site's campaign on that instant's day, in that campaign's timezone.
  const onDay = (at: Date, campaign?: CampaignRow | null) => {
    if (campaign) return { campaign, day: localDateOf(at, campaign.timezone) }
    const siteDay = localDateOf(at, input.timezone)
    const c = campaignOn(siteDay, all)
    return { campaign: c, day: c ? localDateOf(at, c.timezone) : siteDay }
  }

  for (const host of input.hosts) {
    for (const t of input.praying.get(host) ?? []) {
      const { campaign, day } = onDay(new Date(t * 1000))
      add(campaign, day, 'prayers', 1)
      counts.prayers++
    }
  }

  if (await tableExists(wp, table(blogId, 'dt_reports'))) {
    const rows = await wp.unsafe(
      `SELECT parent_id, subtype, value, timestamp FROM ${table(blogId, 'dt_reports')} WHERE post_type = 'campaigns' AND type = 'fuel'`
    ) as { parent_id: number, subtype: string, value: number, timestamp: number }[]
    for (const r of rows) {
      const { campaign, day } = onDay(new Date(Number(r.timestamp) * 1000), input.campaigns.get(Number(r.parent_id)))
      if (r.subtype === 'ongoing') {
        const n = Math.max(0, Number(r.value) || 0)
        if (n) { add(campaign, day, 'group_prayers', n); counts.groupPrayers += n }
      } else {
        add(campaign, day, 'prayers', 1)
        counts.prayers++
      }
    }
  }

  const subs = await postsOf(wp, blogId, 'subscriptions')
  if (subs.length) {
    const meta = await metaOf(wp, blogId, subs.map(s => s.ID))
    const links = await wp.unsafe(`SELECT p2p_from, p2p_to FROM ${table(blogId, 'p2p')} WHERE p2p_type = 'campaigns_to_subscriptions'`) as { p2p_from: number, p2p_to: number }[]
    const campaignsOf = new Map<number, number[]>()
    for (const l of links) campaignsOf.set(Number(l.p2p_to), [...(campaignsOf.get(Number(l.p2p_to)) ?? []), Number(l.p2p_from)])
    for (const s of subs) {
      const at = wpDate(s.post_date_gmt)
      const confirmed = (first(meta.get(s.ID), 'status') ?? 'active') !== 'pending'
      const linked = (campaignsOf.get(s.ID) ?? []).map(id => input.campaigns.get(id)).filter((c): c is CampaignRow => !!c)
      for (const c of linked.length ? linked : [null]) {
        const { campaign, day } = onDay(at, c)
        add(campaign, day, 'signups', 1)
        counts.signups++
        if (confirmed) { add(campaign, day, 'verifications', 1); counts.verifications++ }
      }
    }
  }

  for (const [key, n] of totals) {
    const [campaignId, day, metric] = key.split('|') as [string, string, Metric]
    await bumpStat(tx, campaignId || null, day, metric, n)
  }
  return counts
}
