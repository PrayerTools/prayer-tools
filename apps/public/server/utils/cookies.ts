import type { H3Event } from 'h3'
import { manageCookie, parseLink } from '@prayertools/shared/links'
import { platformConfig } from '@prayertools/shared/config'
import { signJson, verifySignedJson } from '@prayertools/shared/tokens'
import { requestScheme } from './request'

export const MANAGE_COOKIE = 'pt_m'
export const SESSION_COOKIE = 'pt_session'
export const PREVIEW_COOKIE = 'pt_preview'

const DAY = 86_400

function base(event: H3Event) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: requestScheme(event) === 'https', path: '/' }
}

export function setManageCookie(event: H3Event, orgId: string, subscriptionId: string, version: number): void {
  setCookie(event, MANAGE_COOKIE, manageCookie(orgId, subscriptionId, version), { ...base(event), maxAge: 400 * DAY })
}

export function clearManageCookie(event: H3Event): void {
  deleteCookie(event, MANAGE_COOKIE, base(event))
}

// The subscription the manage cookie names, when it belongs to this site.
// The caller still checks the version against the subscription row.
export function readManageCookie(event: H3Event, orgId: string): { subscriptionId: string, version: number } | null {
  const link = parseLink(getCookie(event, MANAGE_COOKIE), 'c')
  if (!link || link.expired || link.orgId !== orgId) return null
  return { subscriptionId: link.subscriptionId, version: link.version ?? 0 }
}

// `domain` set: the cookie covers that domain and all its subdomains.
export function setSessionCookie(event: H3Event, token: string, maxAgeSeconds: number, domain: string | null): void {
  setCookie(event, SESSION_COOKIE, token, { ...base(event), maxAge: maxAgeSeconds, ...(domain ? { domain } : {}) })
}

export function clearSessionCookie(event: H3Event, domain: string | null): void {
  deleteCookie(event, SESSION_COOKIE, { ...base(event), ...(domain ? { domain } : {}) })
}

// Draft preview: the cookie carries a prefix of the current preview token
// hash, so rotating the champion's preview link ends old previews.
export function setPreviewCookie(event: H3Event, orgId: string, tokenHash: string): void {
  setCookie(event, PREVIEW_COOKIE, signJson({ o: orgId, h: tokenHash.slice(0, 16) }, platformConfig().secret), { ...base(event), maxAge: 7 * DAY })
}

export function previewCookieMatches(event: H3Event, orgId: string, tokenHash: string | null): boolean {
  if (!tokenHash) return false
  const p = verifySignedJson<{ o: string, h: string }>(getCookie(event, PREVIEW_COOKIE), platformConfig().secret)
  return !!p && p.o === orgId && p.h === tokenHash.slice(0, 16)
}
