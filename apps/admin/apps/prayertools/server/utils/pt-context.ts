import type { Kysely, Transaction } from 'kysely'
import type { H3Event } from 'h3'
import type { Database } from '#core/server/database/schema'
import { withOrgContext, type TenantContext } from '#tenant/server'
import type { Db as SharedDb, Tx as SharedTx } from '@prayertools/shared/db/scope'
import type { DB } from '@prayertools/shared/db/schema'
import { createDb } from '@prayertools/shared/db/connect'
import { siteSettings } from '@prayertools/shared/site'

// The admin app's Kysely schema is a superset of the shared one; shared
// domain functions take the shared transaction type.
export function ptTx(tx: Transaction<Database>): SharedTx {
  return tx as unknown as SharedTx
}

export function ptNeed(ctx: TenantContext, perm: string): void {
  if (!ctx.perms.has(perm as never)) {
    throw createError({ statusCode: 403, statusMessage: `Permission required: ${perm}` })
  }
}

export function ptBadRequest(message: string, data?: unknown): never {
  throw createError({ statusCode: 400, statusMessage: message, data })
}

export function ptNotFound(message = 'Not found'): never {
  throw createError({ statusCode: 404, statusMessage: message })
}

export async function ptSite(tx: Transaction<Database>) {
  const site = await tx.selectFrom('pt_site').selectAll().executeTakeFirst()
  if (!site) ptNotFound('This organization is not a site.')
  return { ...site, settings_merged: siteSettings(site.settings as Record<string, unknown>) }
}

// BYPASSRLS connection for operator-only cross-site views (search all sites,
// read all stories, review directory listings, retry jobs).
let _adminDb: SharedDb | null = null
export function ptAdminDb(): SharedDb {
  if (!_adminDb) {
    const url = useRuntimeConfig().databaseUrl || process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    _adminDb = createDb<DB>(url, { max: 3 })
  }
  return _adminDb
}

export function ptAppDb(db: Kysely<Database>): SharedDb {
  return db as unknown as SharedDb
}

export function ptClientIp(event: H3Event): string | null {
  return getHeader(event, 'cf-connecting-ip') || getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || getRequestIP(event) || null
}

// Route wrapper for site-scoped endpoints: reads the body before the org
// transaction opens (so no pooled connection waits on the client), runs the
// handler inside the site's org, and checks one permission.
export function definePtHandler<T>(
  perm: string | null,
  fn: (event: H3Event, tx: Transaction<Database>, ctx: TenantContext) => Promise<T>
) {
  return defineEventHandler(async (event) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)) {
      await readBody(event).catch(() => null)
    }
    return await withOrgContext(event, { appId: 'site' }, async (tx, ctx) => {
      if (perm) ptNeed(ctx, perm)
      return await fn(event, tx, ctx)
    })
  })
}

export async function ptBody<T = Record<string, unknown>>(event: H3Event): Promise<T> {
  const body = await readBody(event).catch(() => null)
  return (body && typeof body === 'object' ? body : {}) as T
}
