// Contacts linked to an account whose name or address no longer matches it.
// Changes made on the public server are copied at once; this catches the ones
// made in the admin app's own profile settings.
import { sql } from 'kysely'
import { forEachOrg } from '@prayertools/shared/db/scope'
import { accountById, syncContactFromAccount } from '@prayertools/shared/accounts'
import type { WorkerContext } from '../context'
import type { Logger } from '../log'
import { groupBy } from '../util'

export async function syncLinkedContacts(ctx: WorkerContext, log: Logger): Promise<Record<string, number>> {
  const due = await sql<{ id: string, org_id: string, user_id: string }>`
    SELECT r.id::text AS id, r.org_id::text AS org_id, r.user_id::text AS user_id
    FROM crm_records r JOIN users u ON u.id = r.user_id
    WHERE (u.display_name <> '' AND r.name <> u.display_name)
       OR (u.email IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM crm_contact_channels cc JOIN crm_channels ch ON ch.id = cc.channel_id
         WHERE cc.record_id = r.id AND ch.channel_type = 'email' AND ch.normalized_value = lower(u.email)))
    LIMIT 5000
  `.execute(ctx.admin)
  let synced = 0
  const byOrg = groupBy(due.rows, r => r.org_id)
  await forEachOrg(ctx.app, byOrg.keys(), async (tx, orgId) => {
    for (const row of byOrg.get(orgId) ?? []) {
      const account = await accountById(tx, row.user_id)
      if (!account) continue
      await syncContactFromAccount(tx, row.id, account)
      synced++
    }
  }, (orgId, err) => log.error('account_sync.failed', { site: orgId, err }))
  return { synced }
}
