// Sign-ins on the public server, rows in `pt_account_session` that end with
// the account. The browser holds `<session id>.<secret>` in a cookie, stored
// as a SHA-256 hash. The platform host and `*.<siteBaseHost>` sites, all served
// here, share one cookie set for the shared domain; a custom domain gets its
// own from a hand-off, accepted on that host only, so a site owner's server
// never holds a sign-in that works elsewhere.
import type { H3Event } from 'h3'
import { randomUUID } from 'node:crypto'
import { hashToken, randomToken } from '@prayertools/shared/tokens'
import { accountById, type Account } from '@prayertools/shared/accounts'
import { platformConfig } from '@prayertools/shared/config'
import { useDb } from './db'
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './cookies'
import { clientIp, requestHost } from './request'

export const SESSION_DAYS = 30
const TOUCH_MS = 3_600_000

// Where a session on this request lives: `.<domain>` for the shared domain,
// otherwise the exact host.
function sessionScope(event: H3Event): { key: string, cookieDomain: string | null } {
  const shared = platformConfig().sharedSessionDomain
  const kind = event.context.hostKind as string | undefined
  if (shared && (kind === 'platform' || kind === 'site')) return { key: `.${shared}`, cookieDomain: shared }
  return { key: requestHost(event), cookieDomain: null }
}

export async function startAccountSession(event: H3Event, userId: string): Promise<void> {
  const id = randomUUID()
  const token = `${id}.${randomToken(32)}`
  const ip = clientIp(event)
  const scope = sessionScope(event)
  await useDb().insertInto('pt_account_session').values({
    id,
    user_id: userId,
    host: scope.key,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    user_agent: getRequestHeader(event, 'user-agent')?.slice(0, 500) ?? null,
    ip: ip && ip !== 'unknown' ? ip : null
  }).execute()
  setSessionCookie(event, token, SESSION_DAYS * 86_400, scope.cookieDomain)
  event.context.accountUserId = userId
  event.context.accountSignedInAt = new Date()
}

function sessionIdOf(token: string): string | null {
  const id = token.split('.')[0] ?? ''
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

// The signed-in user on this host, or null.
export async function sessionUserId(event: H3Event): Promise<string | null> {
  if (event.context.accountUserId !== undefined) return event.context.accountUserId as string | null
  const token = getCookie(event, SESSION_COOKIE) ?? ''
  const id = sessionIdOf(token)
  let userId: string | null = null
  if (id) {
    const row = await useDb()
      .selectFrom('pt_account_session')
      .select(['user_id', 'last_used_at', 'created_at'])
      .where('id', '=', id)
      .where('token_hash', '=', hashToken(token))
      .where('host', '=', sessionScope(event).key)
      .where('expires_at', '>', new Date())
      .executeTakeFirst()
    if (row) {
      userId = row.user_id
      event.context.accountSignedInAt = new Date(row.created_at)
      if (Date.now() - new Date(row.last_used_at).getTime() > TOUCH_MS) {
        await useDb().updateTable('pt_account_session').set({ last_used_at: new Date(), expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000) }).where('id', '=', id).execute()
      }
    }
  }
  event.context.accountUserId = userId
  return userId
}

// When the signed-in person on this host last proved who they are (the
// session's start; staying active extends a session but never moves this).
export async function sessionSignedInAt(event: H3Event): Promise<Date | null> {
  return (await sessionUserId(event)) ? event.context.accountSignedInAt as Date : null
}

// Ends every public sign-in of the account, on every host.
export async function endAllAccountSessions(userId: string): Promise<void> {
  await useDb().deleteFrom('pt_account_session').where('user_id', '=', userId).execute()
}

export async function sessionAccount(event: H3Event): Promise<Account | null> {
  const userId = await sessionUserId(event)
  return userId ? await accountById(useDb(), userId) : null
}

export async function requireSessionUser(event: H3Event): Promise<string> {
  const id = await sessionUserId(event)
  if (!id) throw createError({ statusCode: 401, statusMessage: 'Sign in again' })
  return id
}

export async function endAccountSession(event: H3Event): Promise<void> {
  const scope = sessionScope(event)
  const id = sessionIdOf(getCookie(event, SESSION_COOKIE) ?? '')
  if (id) await useDb().deleteFrom('pt_account_session').where('id', '=', id).where('host', '=', scope.key).execute()
  clearSessionCookie(event, scope.cookieDomain)
  event.context.accountUserId = null
}
