// The mail kernel's suppression list (`mail_suppressions`), read in the
// caller's transaction with the kernel's scope rule: global rows (hard
// bounces) apply everywhere, a site's rows (its complaints) to that site, host
// rows to mail no site sends. Rows hold only address hashes, so a suppressed
// address outlives the deletion of the person's data.
import { sql } from 'kysely'
import type { Db, Tx } from '../db/scope'
import { emailHash } from '../tokens'

export async function isSuppressed(db: Db | Tx, email: string, orgId: string | null): Promise<boolean> {
  const res = await sql<{ hit: boolean }>`select mail_is_suppressed(${email}, ${orgId}::uuid) as hit`.execute(db)
  return res.rows[0]?.hit === true
}

// The suppressed addresses among `emails`, lowercased.
export async function suppressedAmong(db: Db | Tx, emails: string[], orgId: string | null): Promise<Set<string>> {
  const addresses = [...new Set(emails.map(e => e.trim().toLowerCase()))]
  if (addresses.length === 0) return new Set()
  const res = await sql<{ address: string }>`
    select a.address from unnest(${addresses}::text[]) as a(address)
    where mail_is_suppressed(a.address, ${orgId}::uuid)
  `.execute(db)
  return new Set(res.rows.map(r => r.address))
}

// Records a suppression the way the kernel would for a host account: global,
// or for one site when `orgId` is given.
export async function suppress(db: Db | Tx, email: string, reason: 'hard_bounce' | 'complaint', detail: string | null, source: string, orgId: string | null = null): Promise<void> {
  await sql`
    insert into mail_suppressions (address_hash, org_id, scope, reason, detail, source, occurred_at)
    values (${emailHash(email)}, ${orgId}::uuid, ${orgId ? 'org' : 'global'}, ${reason}, ${detail?.slice(0, 500) ?? null}, ${source}, now())
    on conflict do nothing
  `.execute(db)
}
