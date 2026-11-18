// Who an email goes to on one site: the chosen audiences narrow who is
// considered, then consent to the audience's purpose and global suppression
// decide. One recipient per email channel.
import { sql } from 'kysely'
import type { AudienceMember, MarketingAudience, MarketingHost, MarketingTx } from './types'
import { uuidArray } from './db'

export interface Candidate extends AudienceMember {
  purpose: string
}

export interface Recipients {
  eligible: Candidate[]
  noConsent: Candidate[]
  suppressed: Candidate[]
}

async function toArray<T>(items: Promise<T[]> | AsyncIterable<T>): Promise<T[]> {
  if (Symbol.asyncIterator in (items as object)) {
    const out: T[] = []
    for await (const item of items as AsyncIterable<T>) out.push(item)
    return out
  }
  return await (items as Promise<T[]>)
}

export async function defaultConsentedAmong(tx: MarketingTx, channelIds: string[], purpose: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < channelIds.length; i += 5000) {
    const rows = await tx
      .selectFrom('crm_channel_consents')
      .select('channel_id')
      .where('purpose', '=', purpose)
      .where('status', '=', 'opt_in')
      .where(sql<boolean>`channel_id = any(${uuidArray(channelIds.slice(i, i + 5000))})`)
      .execute()
    for (const r of rows) out.add(r.channel_id)
  }
  return out
}

export async function defaultFindChannel(tx: MarketingTx, orgId: string, address: string): Promise<string | null> {
  const row = await tx
    .selectFrom('crm_channels')
    .select('id')
    .where('org_id', '=', orgId)
    .where('channel_type', '=', 'email')
    .where('normalized_value', '=', address.trim().toLowerCase())
    .executeTakeFirst()
  return row?.id ?? null
}

export async function audiencesByKey(host: MarketingHost, tx: MarketingTx, orgId: string): Promise<Map<string, MarketingAudience>> {
  return new Map((await host.listAudiences(tx, orgId)).map(a => [a.key, a]))
}

export async function collectRecipients(host: MarketingHost, tx: MarketingTx, orgId: string, audienceKeys: string[]): Promise<Recipients> {
  const known = await audiencesByKey(host, tx, orgId)
  const byChannel = new Map<string, AudienceMember & { purposes: string[] }>()
  for (const key of new Set(audienceKeys)) {
    const audience = known.get(key)
    if (!audience) continue
    for (const m of await toArray(host.resolveAudience(tx, orgId, key))) {
      if (!m.channelId || !m.address) continue
      const seen = byChannel.get(m.channelId)
      if (!seen) {
        byChannel.set(m.channelId, { ...m, purposes: [audience.purpose] })
        continue
      }
      if (!seen.purposes.includes(audience.purpose)) seen.purposes.push(audience.purpose)
      if (m.joinedAt > seen.joinedAt) seen.joinedAt = m.joinedAt
    }
  }

  const consented = new Map<string, Set<string>>()
  const purposes = new Set([...byChannel.values()].flatMap(c => c.purposes))
  for (const purpose of purposes) {
    const ids = [...byChannel.values()].filter(c => c.purposes.includes(purpose)).map(c => c.channelId)
    consented.set(purpose, host.consentedAmong ? await host.consentedAmong(tx, ids, purpose) : await defaultConsentedAmong(tx, ids, purpose))
  }

  const out: Recipients = { eligible: [], noConsent: [], suppressed: [] }
  for (const { purposes: ps, ...m } of byChannel.values()) {
    const purpose = ps.find(p => consented.get(p)?.has(m.channelId))
    if (purpose) out.eligible.push({ ...m, purpose })
    else out.noConsent.push({ ...m, purpose: ps[0]! })
  }
  const suppressed = await host.suppressedAmong(tx, orgId, out.eligible.map(c => c.address.trim().toLowerCase()))
  if (suppressed.size) {
    out.suppressed = out.eligible.filter(c => suppressed.has(c.address.trim().toLowerCase()))
    out.eligible = out.eligible.filter(c => !suppressed.has(c.address.trim().toLowerCase()))
  }
  return out
}

// Eligible recipient counts per audience of the site, plus the combined count
// for a selection (people in several audiences count once).
export async function audienceCounts(host: MarketingHost, tx: MarketingTx, orgId: string, selected: string[] = []) {
  const audiences = await host.listAudiences(tx, orgId)
  const rows = []
  for (const a of audiences) {
    const r = await collectRecipients(host, tx, orgId, [a.key])
    rows.push({ ...a, count: r.eligible.length, notConsented: r.noConsent.length })
  }
  const combined = selected.length ? (await collectRecipients(host, tx, orgId, selected)).eligible.length : 0
  return { audiences: rows, combined }
}
