// Operator routes for platform libraries, signed in by the browser session or
// by an OAuth token carrying the operator-libraries scope (the prayer.tools
// CLI). Either way the user must be an operator on every call, so losing
// operator rights ends a token's access at once.
import type { H3Event } from 'h3'
import { db } from '#core/server/utils/database'
import { getBearerIdentity, requireBearerPermission } from '#core/server/utils/bearer-auth'
import { requireOperatorAdmin } from '#tenant/server'
import { withOrg } from '@prayertools/shared/db/scope'
import { PT_OPERATOR_LIBRARIES } from '../../app/utils/pt-permissions'

export async function ptRequireLibraryOperator(event: H3Event): Promise<{ userId: string }> {
  const bearer = await getBearerIdentity(event)
  if (!bearer) return await requireOperatorAdmin(event)
  requireBearerPermission(event, bearer, PT_OPERATOR_LIBRARIES)
  const user = await db.selectFrom('users').select('is_admin').where('id', '=', bearer.userId).executeTakeFirst()
  if (!user?.is_admin) throw createError({ statusCode: 403, statusMessage: 'Operator admin required' })
  return { userId: bearer.userId }
}

const KEY = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

// A library key as stored: lowercase letters, digits and hyphens.
export function ptLibraryKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const key = String(value).trim().toLowerCase()
  if (!KEY.test(key)) ptBadRequest('Keys are 2–64 lowercase letters, digits and hyphens, e.g. ramadan-2026.')
  return key
}

// The platform library a route names by id or by key.
export async function ptPlatformLibrary(ref: string) {
  const lib = await ptAdminDb().selectFrom('pt_library').selectAll().where('owner_user_id', 'is', null)
    .where(/^[0-9a-f-]{36}$/i.test(ref) ? 'id' : 'key', '=', ref).executeTakeFirst()
  if (!lib) ptNotFound(`No platform library "${ref}".`)
  return lib
}

export interface PtLibraryFollower {
  siteLibraryId: string
  orgId: string
  site: { slug: string, name: string }
  campaigns: string[]
}

// Every site library that follows `libraryId` (shows its published entries),
// with its site and the campaigns using it.
export async function ptLibraryFollowers(libraryId: string): Promise<PtLibraryFollower[]> {
  const db = ptAdminDb()
  const rows = await db.selectFrom('pt_site_library as sl').innerJoin('orgs as o', 'o.id', 'sl.org_id')
    .select(['sl.id', 'sl.org_id', 'o.slug', 'o.name'])
    .where('sl.library_id', '=', libraryId).where('sl.frozen_version', 'is', null).orderBy('o.name').execute()
  if (!rows.length) return []
  const campaigns = await db.selectFrom('pt_campaign_library as cl').innerJoin('pt_campaign as c', 'c.id', 'cl.campaign_id')
    .select(['cl.site_library_id', 'c.name']).where('cl.site_library_id', 'in', rows.map(r => r.id)).orderBy('c.name').execute()
  return rows.map(r => ({
    siteLibraryId: r.id,
    orgId: r.org_id,
    site: { slug: r.slug, name: r.name },
    campaigns: campaigns.filter(c => c.site_library_id === r.id).map(c => c.name)
  }))
}

// Gives each following site its own frozen copy of the library's published
// entries, one site per transaction. A run that stops part-way leaves the
// sites already done with an ordinary frozen copy; running it again finishes.
export async function ptDetachFollowers(followers: PtLibraryFollower[]): Promise<void> {
  for (const f of followers) {
    await withOrg(db as never, f.orgId, tx => ptFreezeCopy(tx as never, f.siteLibraryId))
  }
}
