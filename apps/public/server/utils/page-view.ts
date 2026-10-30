import type { H3Event } from 'h3'
import { negotiateLanguage } from '@prayertools/shared/languages'
import { platformConfig } from '@prayertools/shared/config'
import type { PlatformResponse, ViewResponse } from '../../shared/view'
import { buildSiteResponse } from './views'
import { buildMyView } from './my'
import { sessionUserId } from './account-session'
import { siteForHandoff } from './account-links'
import { safeReturnPath } from '@prayertools/shared/auth-codes'
import { UI_LANGUAGES } from './site-data'
import type { SiteContext } from './site-context'
import { NOT_FOUND_CACHE, PRIVATE_CACHE, SHARED_CACHE, setCache } from './request'

const NOTICES = new Set(['link_invalid', 'link_sent', 'signed_out', 'deleted', 'deleted_kept', 'email_changed', 'email_taken', 'email_kept', 'reauth'])

export async function buildPlatformResponse(event: H3Event, fullPath: string): Promise<PlatformResponse> {
  const url = new URL(fullPath, 'http://x')
  const wanted = url.searchParams.get('lang')
  const lang = wanted && UI_LANGUAGES.includes(wanted) ? wanted : negotiateLanguage(getRequestHeader(event, 'accept-language'), UI_LANGUAGES, 'en')
  if (url.pathname === '/') return { host: 'platform', lang, donateUrl: platformConfig().donateUrl, page: { kind: 'home', adminUrl: platformConfig().adminUrl }, status: 200, cache: 'private', title: 'Prayer.Tools' }
  // Legal pages are written in English only.
  if (url.pathname === '/privacy' || url.pathname === '/terms') return { host: 'platform', lang: 'en', donateUrl: platformConfig().donateUrl, page: { kind: 'legal', doc: url.pathname === '/privacy' ? 'privacy' : 'terms' }, status: 200, cache: 'private', title: 'Prayer.Tools' }
  if (url.pathname !== '/my') return { host: 'platform', lang, donateUrl: platformConfig().donateUrl, page: { kind: 'not_found' }, status: 404, cache: 'private', title: 'Prayer.Tools' }
  const notice = url.searchParams.get('notice')
  // Where to go once signed in: a hand-off to a site or the admin app.
  const continueTo = safeReturnPath(url.searchParams.get('continue'), '')
  const userId = await sessionUserId(event)
  const confirm = userId ? await siteForHandoff(url.searchParams.get('confirm')) : null
  return {
    host: 'platform',
    lang,
    donateUrl: platformConfig().donateUrl,
    page: {
      kind: 'my',
      my: await buildMyView(userId),
      notice: notice && NOTICES.has(notice) ? notice : null,
      continueTo: continueTo.startsWith('/my/') ? continueTo : null,
      confirmSite: confirm ? { host: confirm.host, name: confirm.name, returnTo: safeReturnPath(url.searchParams.get('return')) } : null
    },
    status: 200,
    cache: 'private',
    title: 'Prayer.Tools'
  }
}

export async function buildView(event: H3Event, fullPath: string): Promise<ViewResponse> {
  if (event.context.hostKind === 'platform') return await buildPlatformResponse(event, fullPath)
  const ctx = event.context.site as SiteContext | undefined
  if (!ctx) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return await buildSiteResponse(event, ctx, fullPath)
}

export function applyViewHeaders(event: H3Event, view: ViewResponse): void {
  setCache(event, view.cache !== 'shared' ? PRIVATE_CACHE : view.status === 404 ? NOT_FOUND_CACHE : SHARED_CACHE)
  if (view.host === 'site' && view.robots) setResponseHeader(event, 'x-robots-tag', view.robots)
}
