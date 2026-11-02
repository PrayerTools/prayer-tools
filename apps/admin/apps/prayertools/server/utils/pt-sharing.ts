// Sharing personal library items with named people (core's share kit). Each
// shareable item type has a share table made by the T021 migrations; all of
// them belong to the personal library app.
import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import type { Permission } from '#core/app/utils/permissions'
import { defineShareHandler, runAsShareUser } from '#core/server/utils/shares'
import { db } from '#core/server/utils/database'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'
import type { ShareRole } from '@prayertools/shared/db/schema'
import { PT_LIBRARY_SHARE } from '../../app/utils/pt-permissions'

export const PT_SHARE_TABLES = [
  'pt_library_shares',
  'pt_personal_asset_shares',
  'pt_personal_block_shares',
  'pt_personal_template_shares',
  'marketing_template_shares'
] as const

export type PtShareTable = typeof PT_SHARE_TABLES[number]

// The share routes (list, share, change role, remove, resend) for one item type.
export function definePtShareHandler(table: PtShareTable, label: (tx: Transaction<Database>, id: string) => Promise<string | null>) {
  return defineShareHandler({ appId: PT_LIBRARY_APP, table, permission: PT_LIBRARY_SHARE as Permission, label })
}

// The caller's role on a library: its owner, the role it is shared with them
// in, or null.
export async function ptLibraryRole(libraryId: string, ownerUserId: string | null, userId: string): Promise<'owner' | ShareRole | null> {
  if (ownerUserId && ownerUserId === userId) return 'owner'
  if (!ownerUserId) return null
  const row = await runAsShareUser(userId, tx => ptTx(tx).selectFrom('pt_library_shares').select('role')
    .where('resource_id', '=', libraryId).where('grantee_user_id', '=', userId).executeTakeFirst())
  return row?.role ?? null
}

// The libraries shared with the user, and how.
export async function ptLibrariesSharedWith(userId: string): Promise<Map<string, ShareRole>> {
  const rows = await runAsShareUser(userId, tx => ptTx(tx).selectFrom('pt_library_shares').select(['resource_id', 'role'])
    .where('grantee_user_id', '=', userId).execute())
  return new Map(rows.map(r => [r.resource_id, r.role]))
}

// An item's role for the caller in a list of their own and shared items.
export function ptItemRole(ownerUserId: string, shareRole: ShareRole | null, userId: string): 'owner' | ShareRole {
  return ownerUserId === userId ? 'owner' : (shareRole ?? 'viewer')
}

// Display names of the owners of items shared with the caller.
export async function ptOwnerNames(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map()
  const rows = await db.selectFrom('users').select(['id', 'display_name']).where('id', 'in', [...new Set(userIds)]).execute()
  return new Map(rows.map(r => [r.id, r.display_name]))
}
