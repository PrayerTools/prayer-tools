// Personal links in emails. Manage, unsubscribe, leave-campaign and personal
// prayer-content links carry a token signed with the platform secret, scoped to one
// subscription on one site. Nothing about them is stored, so champions and
// operators can't read one; bumping the subscription's `manage_version`
// rotates every manage link at once. Manage tokens expire, with a "send me a
// fresh link" fallback on the page.
import { platformConfig } from './config'
import { signJson, verifySignedJson } from './tokens'

export const MANAGE_TOKEN_DAYS = 400

interface LinkPayload {
  t: 'm' | 'u' | 'p' | 'c' | 'l'
  s: string
  o: string
  k?: string
  v?: number
  d?: number
}

function secret(): string {
  return platformConfig().secret
}

function nowDay(): number {
  return Math.floor(Date.now() / 86_400_000)
}

export function manageToken(orgId: string, subscriptionId: string, version: number): string {
  return signJson({ t: 'm', s: subscriptionId, o: orgId, v: version, d: nowDay() } satisfies LinkPayload, secret())
}

export function unsubscribeToken(orgId: string, subscriptionId: string): string {
  return signJson({ t: 'u', s: subscriptionId, o: orgId } satisfies LinkPayload, secret())
}

// Leaves one campaign of the subscription: the link in reminder emails.
export function leaveToken(orgId: string, subscriptionId: string, campaignId: string): string {
  return signJson({ t: 'l', s: subscriptionId, o: orgId, k: campaignId } satisfies LinkPayload, secret())
}

// Identifies the person on prayer-content pages opened from a reminder, so
// praying from those links counts as activity. Carried in the URL fragment,
// which never reaches the server or the cache.
export function personalToken(orgId: string, subscriptionId: string): string {
  return signJson({ t: 'p', s: subscriptionId, o: orgId } satisfies LinkPayload, secret())
}

// Manage-session cookie value, set after a manage token is exchanged.
export function manageCookie(orgId: string, subscriptionId: string, version: number): string {
  return signJson({ t: 'c', s: subscriptionId, o: orgId, v: version, d: nowDay() } satisfies LinkPayload, secret())
}

export interface ParsedLink {
  subscriptionId: string
  orgId: string
  version?: number
  expired?: boolean
  campaignId?: string
}

export function parseLink(token: string | null | undefined, kind: LinkPayload['t']): ParsedLink | null {
  const p = verifySignedJson<LinkPayload>(token, secret())
  if (!p || p.t !== kind || typeof p.s !== 'string' || typeof p.o !== 'string') return null
  if (kind === 'l' && typeof p.k !== 'string') return null
  const expired = (kind === 'm' || kind === 'c') && typeof p.d === 'number' && nowDay() - p.d > MANAGE_TOKEN_DAYS
  return { subscriptionId: p.s, orgId: p.o, version: p.v, expired, ...(kind === 'l' ? { campaignId: p.k } : {}) }
}

// URL builders on a site's canonical address.
export function manageUrl(siteUrl: string, orgId: string, subscriptionId: string, version: number): string {
  return `${siteUrl}/m/${manageToken(orgId, subscriptionId, version)}`
}

export function unsubscribeUrl(siteUrl: string, orgId: string, subscriptionId: string): string {
  return `${siteUrl}/u/${unsubscribeToken(orgId, subscriptionId)}`
}

export function leaveUrl(siteUrl: string, orgId: string, subscriptionId: string, campaignId: string): string {
  return `${siteUrl}/l/${leaveToken(orgId, subscriptionId, campaignId)}`
}

export function prayUrl(siteUrl: string, campaignSlug: string | null, day: number | null, lang: string | null, orgId?: string, subscriptionId?: string): string {
  const path = day ? `/pray/${day}` : '/pray'
  const prefix = `${lang ? `/${lang}` : ''}${campaignSlug ? `/${campaignSlug}` : ''}`
  const fragment = orgId && subscriptionId ? `#p=${personalToken(orgId, subscriptionId)}` : ''
  return `${siteUrl}${prefix}${path}${fragment}`
}

// The admin landing-page editor frames the site with this token, which lets
// it render unsaved changes (and draft sites) for one site for a few hours.
export const EDITOR_TOKEN_HOURS = 8

export function editorToken(orgId: string): string {
  return signJson({ t: 'e', o: orgId, x: Math.floor(Date.now() / 1000) + EDITOR_TOKEN_HOURS * 3600 }, secret())
}

export function editorTokenOrg(token: string | null | undefined): string | null {
  const p = verifySignedJson<{ t: string, o: string, x: number }>(token, secret())
  if (!p || p.t !== 'e' || typeof p.o !== 'string' || typeof p.x !== 'number' || p.x < Date.now() / 1000) return null
  return p.o
}
