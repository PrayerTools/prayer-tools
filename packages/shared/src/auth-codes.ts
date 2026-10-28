// Single-use codes for a person's account, stored hashed in `pt_auth_code`:
// emailed sign-in links, the hand-off of a sign-in to another host (the
// admin app, a site's own domain), and confirmation of a new address.
import type { Selectable } from 'kysely'
import type { Db, Tx } from './db/scope'
import type { AuthCodePurpose, PtAuthCodeTable } from './db/schema'
import { hashToken, randomToken } from './tokens'

export const SIGN_IN_MINUTES = 30
// A sign-in link a site's team sends from the admin app.
export const TEAM_SIGN_IN_HOURS = 24
export const HANDOFF_SECONDS = 120
export const EMAIL_CHANGE_MINUTES = 60

export type AuthCode = Selectable<PtAuthCodeTable>

export async function issueAuthCode(db: Db | Tx, input: {
  userId: string
  purpose: AuthCodePurpose
  ttlMs: number
  host?: string | null
  email?: string | null
  returnTo?: string | null
}): Promise<string> {
  const code = randomToken(32)
  await db.insertInto('pt_auth_code').values({
    user_id: input.userId,
    purpose: input.purpose,
    code_hash: hashToken(code),
    host: input.host ?? null,
    email: input.email ?? null,
    return_to: input.returnTo ?? null,
    expires_at: new Date(Date.now() + input.ttlMs)
  }).execute()
  return code
}

// Uses up a code. A hand-off code only works on the host it was issued for.
export async function takeAuthCode(db: Db | Tx, code: string, purpose: AuthCodePurpose, host?: string): Promise<AuthCode | null> {
  if (!code || code.length > 200) return null
  const row = await db
    .updateTable('pt_auth_code')
    .set({ used_at: new Date() })
    .where('code_hash', '=', hashToken(code))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .returningAll()
    .executeTakeFirst()
  if (!row) return null
  if (purpose === 'handoff' && row.host !== (host ?? '').toLowerCase()) return null
  return row
}

// A same-site path to return to after signing in: `/…`, never `//…`.
export function safeReturnPath(value: unknown, fallback = '/'): string {
  return typeof value === 'string' && /^\/(?![/\\])[^\s]*$/.test(value) && value.length <= 500 ? value : fallback
}
