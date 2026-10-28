// Sign-ins on the public server. Each one is a row in core's `sessions` table,
// so it shows in the account's session list and ends with the account; the
// browser holds `<session id>.<secret>` in a cookie on the host it signed in
// on (the platform host, or a site that received a hand-off), stored as a
// SHA-256 hash.
import type { H3Event } from 'h3'
import { randomUUID } from 'node:crypto'
import { hashToken, randomToken } from '@prayertools/shared/tokens'
import { accountById, type Account } from '@prayertools/shared/accounts'
import { useDb } from './db'
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './cookies'
import { clientIp } from './request'

export const SESSION_DAYS = 30
const TOUCH_MS = 3_600_000

export async function startAccountSession(event: H3Event, userId: string): Promise<void> {
  const id = randomUUID()
  const token = `${id}.${randomToken(32)}`
  const ip = clientIp(event)
  await useDb().insertInto('sessions').values({
    id,
    user_id: userId,
    client: 'web',
    refresh_token_hash: hashToken(token),
    expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    user_agent: getRequestHeader(event, 'user-agent')?.slice(0, 500) ?? null,
    ip: ip && ip !== 'unknown' ? ip : null
  }).execute()
  setSessionCookie(event, token, SESSION_DAYS * 86_400)
  event.context.accountUserId = userId
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
      .selectFrom('sessions')
      .select(['user_id', 'last_used_at'])
      .where('id', '=', id)
      .where('refresh_token_hash', '=', hashToken(token))
      .where('expires_at', '>', new Date())
      .executeTakeFirst()
    if (row) {
      userId = row.user_id
      if (Date.now() - new Date(row.last_used_at).getTime() > TOUCH_MS) {
        await useDb().updateTable('sessions').set({ last_used_at: new Date(), expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000) }).where('id', '=', id).execute()
      }
    }
  }
  event.context.accountUserId = userId
  return userId
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
  const id = sessionIdOf(getCookie(event, SESSION_COOKIE) ?? '')
  if (id) await useDb().deleteFrom('sessions').where('id', '=', id).execute()
  clearSessionCookie(event)
  event.context.accountUserId = null
}
