import type { H3Event } from 'h3'
import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import { db } from '#core/server/utils/database'
import { withUserContext } from '#core/server/utils/personal-apps'
import { listUserOrgs, withOrgContext, withOrgScope, type TenantContext } from '#tenant/server'
import { getMarketingHost } from '../../lib/registry'
import { parseVersions } from '../../lib/render'
import type { EmailVersions, MarketingDb, MarketingHost, MarketingTx } from '../../lib/types'

export type MarketingPerm = 'marketing.access' | 'marketing.send'

export function marketingTx(tx: Transaction<Database>): MarketingTx {
  return tx as unknown as MarketingTx
}

export function marketingDb(): MarketingDb {
  return db as unknown as MarketingDb
}

export function marketingHost(): MarketingHost {
  const host = getMarketingHost()
  if (!host) throw createError({ statusCode: 503, statusMessage: 'Site email is not set up on this server.' })
  return host
}

// Errors thrown by the layer's plain modules carry a statusCode; surface them
// as HTTP errors instead of 500s.
function asHttpError(err: unknown): never {
  const e = err as { statusCode?: number, statusMessage?: string, message?: string }
  if (e && typeof e.statusCode === 'number' && !(err as { __h3_error__?: boolean }).__h3_error__) {
    throw createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? e.message })
  }
  throw err
}

// Site-scoped endpoints: reads the body before the org transaction opens, runs
// inside the active org and checks one permission.
export function defineMarketingHandler<T>(
  perm: MarketingPerm,
  fn: (event: H3Event, tx: Transaction<Database>, ctx: TenantContext) => Promise<T>
) {
  return defineEventHandler(async (event) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)) {
      await readBody(event).catch(() => null)
    }
    try {
      return await withOrgContext(event, { appId: 'marketing' }, async (tx, ctx) => {
        if (!ctx.perms.has(perm as never)) {
          throw createError({ statusCode: 403, statusMessage: `Permission required: ${perm}` })
        }
        return await fn(event, tx, ctx)
      })
    } catch (err) {
      asHttpError(err)
    }
  })
}

// A user's own rows (templates, multi-site sends): signed in, no org, inside
// the host's personal app, whose transaction sets `app.current_user` so only
// the caller's rows are visible.
export function defineMarketingUserHandler<T>(fn: (event: H3Event, tx: MarketingTx, userId: string) => Promise<T>) {
  return defineEventHandler(async (event) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)) {
      await readBody(event).catch(() => null)
    }
    try {
      return await withUserContext(event, { appId: marketingHost().personalAppId }, async (tx, ctx) => await fn(event, marketingTx(tx), ctx.userId))
    } catch (err) {
      asHttpError(err)
    }
  })
}

export async function marketingBody<T = Record<string, unknown>>(event: H3Event): Promise<T> {
  const body = await readBody(event).catch(() => null)
  return (body && typeof body === 'object' ? body : {}) as T
}

export function marketingBadRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

export function marketingNotFound(message = 'Not found'): never {
  throw createError({ statusCode: 404, statusMessage: message })
}

export function marketingIsUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export interface MarketingDraftInput {
  versions: EmailVersions
  sourceLanguage: string
  audiences: string[]
}

// Validates composer input against the languages the site (or sites) run in.
export function marketingDraftInput(body: Record<string, unknown>, languages: string[]): MarketingDraftInput {
  const sourceLanguage = String(body.source_language ?? '')
  if (!languages.includes(sourceLanguage)) marketingBadRequest('Choose one of the site\'s languages as the source language.')
  const versions = parseVersions(body.versions ?? {}, languages)
  if (!versions[sourceLanguage]) versions[sourceLanguage] = { subject: '', content: { type: 'doc', content: [] } }
  const audiences = Array.isArray(body.audiences) ? [...new Set(body.audiences.map(a => String(a)).filter(a => /^[a-z0-9_:.-]{1,80}$/i.test(a)))] : []
  return { versions, sourceLanguage, audiences }
}

export function marketingScheduleTime(raw: unknown): Date {
  if (raw === null || raw === undefined || raw === '') return new Date()
  const d = new Date(String(raw))
  if (Number.isNaN(d.getTime())) marketingBadRequest('Invalid schedule time.')
  if (d.getTime() > Date.now() + 366 * 86_400_000) marketingBadRequest('Schedule within the next year.')
  return d.getTime() < Date.now() ? new Date() : d
}

export async function marketingUserEmail(userId: string): Promise<{ email: string, name: string }> {
  const u = await db.selectFrom('users').select(['email', 'display_name']).where('id', '=', userId).where('email', 'is not', null).$narrowType<{ email: string }>().executeTakeFirstOrThrow()
  return { email: u.email, name: u.display_name }
}

// Runs `fn` in its own transaction inside one org's RLS scope, for a
// user-owned (org-less) request that works on each chosen site in turn.
export async function marketingInOrg<T>(orgId: string, fn: (tx: MarketingTx) => Promise<T>): Promise<T> {
  return await withOrgScope(orgId, async tx => await fn(marketingTx(tx)))
}

export interface MarketingSite {
  id: string
  slug: string
  name: string
}

// Every site where the user may send site email.
export async function marketingSendableSites(userId: string): Promise<MarketingSite[]> {
  const orgs = await listUserOrgs(userId, { permission: 'marketing.send' as never, appId: 'marketing' })
  return orgs.map(o => ({ id: o.id, slug: o.slug, name: o.name }))
}

export function marketingClientIp(event: H3Event): string | null {
  return getHeader(event, 'cf-connecting-ip') || getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || getRequestIP(event) || null
}

// The chosen sites, each of which the user must be able to send from.
export async function marketingRequireSites(userId: string, orgIds: unknown): Promise<MarketingSite[]> {
  const ids = Array.isArray(orgIds) ? [...new Set(orgIds.filter(marketingIsUuid))] : []
  if (!ids.length) marketingBadRequest('Choose at least one site.')
  const sendable = await marketingSendableSites(userId)
  const chosen = ids.map(id => sendable.find(s => s.id === id))
  if (chosen.some(s => !s)) throw createError({ statusCode: 403, statusMessage: 'You can\'t send site email from one of the chosen sites.' })
  return chosen as MarketingSite[]
}

// Languages across the chosen sites (union, in first-seen order).
export async function marketingSitesLanguages(orgIds: string[]) {
  const host = marketingHost()
  const seen = new Map<string, { code: string, label: string, dir: 'ltr' | 'rtl' }>()
  const perSite: Record<string, { languages: string[], defaultLanguage: string }> = {}
  for (const orgId of orgIds) {
    const l = await marketingInOrg(orgId, tx => host.languages(tx, orgId))
    perSite[orgId] = { languages: l.languages.map(x => x.code), defaultLanguage: l.defaultLanguage }
    for (const lang of l.languages) if (!seen.has(lang.code)) seen.set(lang.code, lang)
  }
  return { languages: [...seen.values()], perSite }
}
