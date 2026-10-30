// Contacts linked to an account whose name or address no longer matches it.
// Changes are copied at once (the public server, and the admin app through
// core's `user.updated` hook); this catches any a failed copy left behind.
import { sql } from 'kysely'
import { forEachOrg } from '@prayertools/shared/db/scope'
import { accountById, syncContactFromAccount } from '@prayertools/shared/accounts'
import type { WorkerContext } from '../context'
import type { Logger } from '../log'
import { groupBy } from '../util'

const BATCH = 1000

// Compares the way the sync writes: names trimmed and cut to 200 characters,
// addresses trimmed and lowercased. Walks contacts in id order, so rows that
// stay due cannot keep the rest from syncing.
export async function syncLinkedContacts(ctx: WorkerContext, log: Logger): Promise<Record<string, number>> {
  let synced = 0
  let after = '00000000-0000-0000-0000-000000000000'
  while (!ctx.stopping()) {
    const due = await sql<{ id: string, org_id: string, user_id: string }>`
      SELECT r.id::text AS id, r.org_id::text AS org_id, r.user_id::text AS user_id
      FROM crm_records r JOIN users u ON u.id = r.user_id
      WHERE r.id > ${after}::uuid
        AND ((btrim(u.display_name) <> '' AND r.name <> left(btrim(u.display_name), 200))
          OR (u.email IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM crm_contact_channels cc JOIN crm_channels ch ON ch.id = cc.channel_id
            WHERE cc.record_id = r.id AND ch.channel_type = 'email' AND ch.normalized_value = lower(btrim(u.email)))))
      ORDER BY r.id
      LIMIT ${BATCH}
    `.execute(ctx.admin)
    if (!due.rows.length) break
    after = due.rows[due.rows.length - 1]!.id
    const byOrg = groupBy(due.rows, r => r.org_id)
    await forEachOrg(ctx.app, byOrg.keys(), async (tx, orgId) => {
      for (const row of byOrg.get(orgId) ?? []) {
        const account = await accountById(tx, row.user_id)
        if (!account) continue
        await syncContactFromAccount(tx, row.id, account)
        synced++
      }
    }, (orgId, err) => log.error('account_sync.failed', { site: orgId, err }))
    if (due.rows.length < BATCH) break
  }
  return { synced }
}
