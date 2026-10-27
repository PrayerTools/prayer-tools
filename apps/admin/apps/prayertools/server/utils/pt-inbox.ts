import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'

// Site members who can open the inbox, so can be notified of contact messages.
export async function ptInboxMembers(tx: Transaction<Database>, orgId: string) {
  const ids = await inboxUsersWithAccess(tx, orgId)
  if (!ids.length) return []
  const rows = await tx
    .selectFrom('memberships')
    .innerJoin('users', 'users.id', 'memberships.user_id')
    .select(['users.id', 'users.display_name', 'users.email', 'memberships.roles'])
    .where('memberships.org_id', '=', orgId)
    .where('users.id', 'in', ids)
    .orderBy('users.display_name')
    .execute()
  return rows.map(r => ({ id: r.id, name: r.display_name || r.email, email: r.email, admin: (r.roles ?? []).some(x => x === 'admin' || x === 'owner') }))
}
