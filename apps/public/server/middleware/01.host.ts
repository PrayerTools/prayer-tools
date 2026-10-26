// Host routing. `api.` serves only the app API, `go.` short links, the
// platform host My prayer; every other host must resolve to a site (unknown
// hosts get a 404, never a default site).
import type { H3Event } from 'h3'
import { classifyHost } from '@prayertools/shared/site'
import { withOrg } from '@prayertools/shared/db/scope'
import { siteUrlFor } from '@prayertools/shared/site'
import { useDb } from '../utils/db'
import { NOT_FOUND_CACHE, PRIVATE_CACHE, limit, requestHost, setCache } from '../utils/request'
import { buildSiteContext, resolveSiteCached } from '../utils/site-context'
import { previewCookieMatches } from '../utils/cookies'
import { addTimesLink, checkinAnswer, exchangeManageLink, legacyFuel, legacyManage, previewLink, unsubscribePost, verifyLink } from '../utils/actions'
import { editorAccess, editorFrameAncestors } from '../utils/editor'
import { exchangeMyToken } from '../utils/my-auth'

const ASSET_PREFIXES = ['/_nuxt/', '/__nuxt', '/@', '/node_modules/', '/_fonts/', '/__vite', '/api/_nuxt_icon/', '/_i18n/']

function isAsset(path: string): boolean {
  return ASSET_PREFIXES.some(p => path.startsWith(p)) || path === '/favicon.ico' || path === '/apple-touch-icon.png'
}

export function notFound(event: H3Event, cacheable = true) {
  setResponseStatus(event, 404)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setCache(event, cacheable ? NOT_FOUND_CACHE : PRIVATE_CACHE)
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title></head>'
    + '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1c1917"><h1>Page not found</h1>'
    + '<p>There is no prayer campaign at this address.</p><p><a href="https://prayer.tools">Prayer.Tools</a></p></body></html>'
}

function marketingUrl(): string {
  return process.env.PT_MARKETING_URL || 'https://prayer.tools'
}

export default defineEventHandler(async (event) => {
  const pathname = event.path.split('?')[0]!
  if (isAsset(pathname)) return
  const host = requestHost(event)
  const kind = classifyHost(host)
  event.context.hostKind = kind.kind
  setCache(event, PRIVATE_CACHE)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'referrer-policy', 'strict-origin-when-cross-origin')
  const isGet = event.method === 'GET' || event.method === 'HEAD'

  if (kind.kind === 'api') {
    if (pathname.startsWith('/v1/') || pathname === '/v1' || pathname.startsWith('/.well-known/') || pathname === '/robots.txt') return
    return notFound(event)
  }

  if (kind.kind === 'go') {
    if (pathname.startsWith('/.well-known/') || pathname === '/robots.txt') return
    const segs = pathname.split('/').filter(Boolean)
    if (!segs.length) return sendRedirect(event, marketingUrl(), 302)
    const slug = segs[0]!.toLowerCase()
    const org = await useDb().selectFrom('orgs').select(['id', 'slug', 'suspended_at']).where('slug', '=', slug).executeTakeFirst()
    if (!org || org.suspended_at) return notFound(event)
    const target = await withOrg(useDb(), org.id, async (tx) => {
      const site = await tx.selectFrom('pt_site').select('status').executeTakeFirst()
      if (!site || site.status === 'draft') return null
      return await siteUrlFor(tx, org.id, org.slug)
    })
    if (!target) return notFound(event)
    const query = event.path.includes('?') ? event.path.slice(event.path.indexOf('?')) : ''
    setCache(event, 'public, max-age=300, s-maxage=300')
    return sendRedirect(event, `${target}/${segs.slice(1).join('/')}${query}`.replace(/\/(\?|$)/, '$1'), 302)
  }

  if (kind.kind === 'platform') {
    // With PT_MARKETING_URL set, the marketing site owns "/"; otherwise the landing view renders.
    if ((pathname === '/' || pathname === '') && process.env.PT_MARKETING_URL) return sendRedirect(event, marketingUrl(), 302)
    if (pathname === '/' || pathname === '' || pathname === '/robots.txt') return
    const m = pathname.match(/^\/my\/login\/([^/]+)$/)
    if (m && isGet) return await exchangeMyToken(event, decodeURIComponent(m[1]!))
    if (pathname === '/my' || pathname.startsWith('/my/') || pathname.startsWith('/api/my/') || pathname === '/api/view') return
    return notFound(event)
  }

  // Site subdomains and custom domains.
  const resolved = await resolveSiteCached(host)
  if (!resolved || resolved.suspended) return notFound(event)
  const ctx = buildSiteContext(event, host, kind.kind, resolved)
  event.context.site = ctx

  if (resolved.shouldRedirect && isGet && !pathname.startsWith('/.well-known/')) {
    return sendRedirect(event, `https://${resolved.activeDomain}${event.path}`, 301)
  }
  if (pathname.startsWith('/v1/') || pathname === '/v1' || pathname === '/my' || pathname.startsWith('/my/') || pathname.startsWith('/api/my/')) return notFound(event)
  if (pathname.startsWith('/.well-known/') && kind.kind !== 'site') return notFound(event)

  const segs = pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s))

  ctx.editor = editorAccess(event, ctx.orgId)
  if (ctx.editor) {
    ctx.preview = true
    setResponseHeader(event, 'x-robots-tag', 'noindex')
  }

  if (resolved.status === 'draft' && !ctx.editor) {
    if (segs[0] === 'preview' && segs[1] && isGet) {
      if (await previewLink(event, ctx, segs[1])) return
      return notFound(event, false)
    }
    const hash = await withOrg(useDb(), ctx.orgId, tx => tx.selectFrom('pt_site').select('preview_token_hash').executeTakeFirst())
    if (!previewCookieMatches(event, ctx.orgId, hash?.preview_token_hash ?? null)) return notFound(event, false)
    ctx.preview = true
    setResponseHeader(event, 'x-robots-tag', 'noindex')
  }

  const embed = segs[segs.length - 1] === 'embed' || pathname === '/embed.js'
  if (ctx.editor) {
    setResponseHeader(event, 'content-security-policy', editorFrameAncestors())
  } else if (!embed) {
    setResponseHeader(event, 'x-frame-options', 'SAMEORIGIN')
    setResponseHeader(event, 'content-security-policy', "frame-ancestors 'self'")
  }

  const [first, second, third] = segs
  if (event.method === 'POST' && first === 'u' && second && segs.length === 2) {
    limit(event, 'unsubscribe', 30, 60_000)
    return await unsubscribePost(event, ctx, second)
  }
  if (!isGet) return
  if (first === 'm' && second && segs.length === 2) return await exchangeManageLink(event, ctx, second)
  if (first === 'verify' && second && segs.length === 2) return await verifyLink(event, ctx, second)
  if (first === 'add' && second && segs.length === 2) return await addTimesLink(event, ctx, second)
  if (first === 'checkin' && second && third && segs.length === 3) return await checkinAnswer(event, ctx, second, third)
  if (first === 'subscriptions_app' && second === 'manage') return await legacyManage(event, ctx, third ?? '')
  if (segs.includes('fuel')) {
    const data = await withOrg(useDb(), ctx.orgId, async tx => ({
      languages: (await tx.selectFrom('pt_site').select('languages').executeTakeFirst())?.languages ?? [],
      slugs: (await tx.selectFrom('pt_campaign').select('slug').execute()).map(r => r.slug)
    }))
    return await legacyFuel(event, ctx, segs, data.languages, data.slugs)
  }
})
