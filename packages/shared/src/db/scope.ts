// The two RLS scopes. Site scope sets `app.current_org` (the same GUC the
// tenancy layer's `defineTenantHandler` sets); person scope sets
// `app.current_intercessor` to the person's user id. Both are SET LOCAL, so
// they live only inside the transaction — safe under PgBouncer transaction
// pooling.
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from './schema'

export type Tx = Transaction<DB>
export type Db = Kysely<DB>

export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction().execute(async (tx) => {
    await sql`select set_config('app.current_org', ${orgId}, true)`.execute(tx)
    return await fn(tx)
  })
}

export async function withPerson<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction().execute(async (tx) => {
    await sql`select set_config('app.current_intercessor', ${userId}, true)`.execute(tx)
    return await fn(tx)
  })
}

// Runs `fn` once per org, each inside its own org transaction. Sweeps find
// the org ids with a set-based query and hand them here; a failure in one org
// is reported and never stops the others.
export async function forEachOrg<T>(
  db: Db,
  orgIds: Iterable<string>,
  fn: (tx: Tx, orgId: string) => Promise<T>,
  onError: (orgId: string, err: unknown) => void = (orgId, err) => console.error(`[forEachOrg] ${orgId}`, err)
): Promise<Map<string, T>> {
  const results = new Map<string, T>()
  for (const orgId of new Set(orgIds)) {
    try {
      results.set(orgId, await withOrg(db, orgId, tx => fn(tx, orgId)))
    } catch (err) {
      onError(orgId, err)
    }
  }
  return results
}
