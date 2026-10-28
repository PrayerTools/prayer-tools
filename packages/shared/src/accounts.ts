// The person's user account (Nuxtinator `users`). A web signup finds the
// account for its address or creates an unverified one; the subscription is
// linked to the account once the address is verified, and so is the site's
// CRM contact, which from then on shows the account's name and email. App
// installs get an account without an address. `users` has no RLS: every
// lookup here is by an explicit id or address.
import { sql } from 'kysely'
import { withOrg, type Db, type Tx } from './db/scope'
import { normalizeEmail, primaryEmailOf, replaceContactEmail, setContactName } from './crm'

export interface Account {
  id: string
  email: string | null
  display_name: string
  verified: boolean
}

const COLUMNS = ['id', 'email', 'display_name', 'verified'] as const

export async function accountById(db: Db | Tx, userId: string): Promise<Account | null> {
  return await db.selectFrom('users').select(COLUMNS).where('id', '=', userId).executeTakeFirst() ?? null
}

export async function accountByEmail(db: Db | Tx, email: string): Promise<Account | null> {
  const { normalized } = normalizeEmail(email)
  return await db.selectFrom('users').select(COLUMNS).where(sql`lower(email)`, '=', normalized).executeTakeFirst() ?? null
}

// The account for an address, created unverified when there is none. An
// existing account keeps its name; a nameless one takes the signup's.
export async function ensureAccount(db: Db | Tx, email: string, name?: string | null): Promise<Account> {
  const { normalized } = normalizeEmail(email)
  const displayName = (name ?? '').trim().slice(0, 200)
  const existing = await accountByEmail(db, normalized)
  if (existing) {
    if (!existing.display_name && displayName) {
      await db.updateTable('users').set({ display_name: displayName, updated: new Date() }).where('id', '=', existing.id).execute()
      return { ...existing, display_name: displayName }
    }
    return existing
  }
  await db
    .insertInto('users')
    .values({ email: normalized, display_name: displayName, verified: false })
    .onConflict(oc => oc.doNothing())
    .execute()
  return (await accountByEmail(db, normalized))!
}

// An account with no address, for an app install.
export async function createAnonymousAccount(db: Db | Tx): Promise<string> {
  const row = await db.insertInto('users').values({ email: null, display_name: '' }).returning('id').executeTakeFirstOrThrow()
  return row.id
}

export async function markAccountVerified(db: Db | Tx, userId: string): Promise<void> {
  await db.updateTable('users').set({ verified: true, updated: new Date() }).where('id', '=', userId).where('verified', '=', false).execute()
}

// The contact shows the account's name and address. A nameless account
// takes the contact's name instead.
export async function syncContactFromAccount(tx: Tx, contactId: string, account: Account): Promise<void> {
  if (account.display_name) {
    await setContactName(tx, contactId, account.display_name)
  } else {
    const contact = await tx.selectFrom('crm_records').select('name').where('id', '=', contactId).executeTakeFirst()
    const email = await primaryEmailOf(tx, contactId)
    const name = contact?.name.trim() ?? ''
    if (name && name !== email?.email.split('@')[0]) {
      await tx.updateTable('users').set({ display_name: name.slice(0, 200), updated: new Date() }).where('id', '=', account.id).where('display_name', '=', '').execute()
    }
  }
  if (account.email) await replaceContactEmail(tx, contactId, account.email, account.verified)
}

// Links a verified subscription, and its contact, to the account.
export async function linkSubscriptionToAccount(tx: Tx, subscriptionId: string, account: Account): Promise<void> {
  const sub = await tx.selectFrom('pt_subscription').select(['id', 'user_id', 'contact_id']).where('id', '=', subscriptionId).executeTakeFirst()
  if (!sub) return
  if (sub.user_id !== account.id) {
    await tx.updateTable('pt_subscription').set({ user_id: account.id, updated_at: new Date() }).where('id', '=', sub.id).execute()
  }
  if (sub.contact_id) await linkContactToAccount(tx, sub.contact_id, account)
}

export async function linkContactToAccount(tx: Tx, contactId: string, account: Account): Promise<void> {
  // One linked contact per account in a site: another contact holding the link keeps it.
  const holder = await tx
    .selectFrom('crm_records')
    .select('id')
    .where('user_id', '=', account.id)
    .where('record_type', '=', 'contacts')
    .where('org_id', '=', eb => eb.selectFrom('crm_records as c').select('c.org_id').where('c.id', '=', contactId))
    .executeTakeFirst()
  if (holder && holder.id !== contactId) return
  if (!holder) await tx.updateTable('crm_records').set({ user_id: account.id }).where('id', '=', contactId).execute()
  await syncContactFromAccount(tx, contactId, account)
}

// Copies the account's name and address onto its contact in each of the
// given sites, one site per transaction.
export async function syncAccountContacts(db: Db, orgIds: Iterable<string>, account: Account): Promise<void> {
  for (const orgId of new Set(orgIds)) {
    await withOrg(db, orgId, async (tx) => {
      const contacts = await tx.selectFrom('crm_records').select('id').where('user_id', '=', account.id).execute()
      for (const c of contacts) await syncContactFromAccount(tx, c.id, account)
    })
  }
}

// The org ids of every site whose contact or subscription is linked to the
// account. Runs on the admin connection: it spans every site.
export async function accountOrgIds(admin: Db, userId: string): Promise<string[]> {
  const rows = await sql<{ org_id: string }>`
    SELECT org_id::text AS org_id FROM pt_subscription WHERE user_id = ${userId}
    UNION
    SELECT org_id::text AS org_id FROM crm_records WHERE user_id = ${userId}
  `.execute(admin)
  return rows.rows.map(r => r.org_id)
}

// Removes an account nothing uses any more: no subscription, contact, app
// device or membership, no password and not a platform admin. Runs on the
// admin connection, since use spans every site.
export async function deleteAccountIfUnused(tx: Tx, userId: string): Promise<boolean> {
  const res = await sql<{ id: string }>`
    DELETE FROM users u
    WHERE u.id = ${userId} AND u.password IS NULL AND NOT u.is_admin
      AND NOT EXISTS (SELECT 1 FROM pt_subscription s WHERE s.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM crm_records r WHERE r.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM pt_user_device d WHERE d.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
    RETURNING u.id
  `.execute(tx)
  return res.rows.length > 0
}
