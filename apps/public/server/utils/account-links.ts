// Account link targets. On the platform host: emailed sign-in links, new
// address confirmations, and hand-offs of the sign-in to a site's host or the
// admin app. On a site's host: starting a sign-in (sent to the platform host)
// and redeeming the hand-off code it comes back with.
import type { H3Event } from 'h3'
import { platformConfig, platformOrigin } from '@prayertools/shared/config'
import { classifyHost } from '@prayertools/shared/site'
import { HANDOFF_SECONDS, issueAuthCode, safeReturnPath, takeAuthCode } from '@prayertools/shared/auth-codes'
import { accountByEmail, accountById, markAccountVerified, syncAccountContacts } from '@prayertools/shared/accounts'
import { useDb } from './db'
import { endAllAccountSessions, sessionSignedInAt, sessionUserId, startAccountSession } from './account-session'
import { accountSiteIds, personSubscriptions } from './my'
import { resolveSiteCached } from './site-context'
import type { SiteContext } from './site-context'

export const ADMIN_SIGN_IN_HOURS = 24

function myRedirect(event: H3Event, query: Record<string, string>) {
  return sendRedirect(event, `/my?${new URLSearchParams(query)}`, 302)
}

// `/my/login/<code>`: the emailed link signs the person in. Opening it proves
// they hold the address, so an unverified account becomes verified.
export async function exchangeSignInLink(event: H3Event, code: string) {
  const row = await takeAuthCode(useDb(), code, 'sign_in')
  if (!row) return myRedirect(event, { notice: 'link_invalid' })
  await markAccountVerified(useDb(), row.user_id)
  await startAccountSession(event, row.user_id)
  const next = safeReturnPath(row.return_to, '/my')
  return sendRedirect(event, next.startsWith('/my') ? next : '/my', 302)
}

// `/my/email/<code>`: confirms a new address and copies it onto the
// person's contact on every site. Opening the link doesn't sign anyone in:
// a mistyped address would otherwise hand its owner the account.
export async function confirmEmailChange(event: H3Event, code: string) {
  const db = useDb()
  const row = await takeAuthCode(db, code, 'email_change')
  if (!row?.email) return myRedirect(event, { notice: 'link_invalid' })
  return myRedirect(event, { notice: (await setAccountEmail(row.user_id, row.email)) ? 'email_changed' : 'email_taken' })
}

// `/my/email-undo/<code>`: from the notice sent to the old address. Keeps or
// restores that address, cancels pending changes, and signs out everyone
// else, since whoever holds the other address may have signed in with it.
export async function undoEmailChange(event: H3Event, code: string) {
  const db = useDb()
  const row = await takeAuthCode(db, code, 'email_undo')
  if (!row?.email) return myRedirect(event, { notice: 'link_invalid' })
  await db.updateTable('pt_auth_code').set({ used_at: new Date() }).where('user_id', '=', row.user_id).where('purpose', '=', 'email_change').where('used_at', 'is', null).execute()
  if (!(await setAccountEmail(row.user_id, row.email))) return myRedirect(event, { notice: 'email_taken' })
  await endAllAccountSessions(row.user_id)
  await db.deleteFrom('sessions').where('user_id', '=', row.user_id).execute()
  await startAccountSession(event, row.user_id)
  return myRedirect(event, { notice: 'email_kept' })
}

// Gives the account this address and copies it to every site's contact.
// False when another account already uses it.
async function setAccountEmail(userId: string, email: string): Promise<boolean> {
  const db = useDb()
  const taken = await accountByEmail(db, email)
  if (taken && taken.id !== userId) return false
  if (taken?.id === userId && taken.email === email) return true
  await db.updateTable('users').set({ email, verified: true, updated: new Date() }).where('id', '=', userId).execute()
  const account = (await accountById(db, userId))!
  await syncAccountContacts(db, await accountSiteIds(account.id), account)
  return true
}

export interface HandoffSite {
  host: string
  orgId: string
  name: string
}

export async function siteForHandoff(host: unknown): Promise<HandoffSite | null> {
  const h = typeof host === 'string' ? host.toLowerCase() : ''
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(h) || h === platformConfig().platformHost) return null
  const resolved = await resolveSiteCached(h)
  return resolved && !resolved.suspended ? { host: h, orgId: resolved.orgId, name: resolved.name } : null
}

// A site the person prays with or helps run.
async function isOwnSite(userId: string, orgId: string): Promise<boolean> {
  if ((await personSubscriptions(userId)).some(s => s.org_id === orgId)) return true
  return !!await useDb().selectFrom('memberships').select('id').where('user_id', '=', userId).where('org_id', '=', orgId).executeTakeFirst()
}

export async function handoffUrl(userId: string, host: string, back: string): Promise<string> {
  const code = await issueAuthCode(useDb(), { userId, purpose: 'handoff', host, ttlMs: HANDOFF_SECONDS * 1000 })
  return `${platformConfig().siteScheme}://${host}/account/claim/${code}?return=${encodeURIComponent(back)}`
}

function adminHost(): string {
  return new URL(platformConfig().adminUrl).host.toLowerCase()
}

function continueLater(event: H3Event) {
  return myRedirect(event, { continue: event.path })
}

// `/my/continue?host=<site host>&return=<path>`: sends the signed-in person
// back to the site. A site on the shared domain already sees the sign-in; a
// custom domain gets a one-time code, and one that is not their own waits
// for them to confirm on My prayer, since its owner then learns who they are.
export async function continueToSite(event: H3Event) {
  const q = getQuery(event)
  const site = await siteForHandoff(q.host)
  if (!site) return myRedirect(event, { notice: 'link_invalid' })
  const userId = await sessionUserId(event)
  if (!userId) return continueLater(event)
  const back = safeReturnPath(q.return)
  if (platformConfig().sharedSessionDomain && classifyHost(site.host).kind === 'site') {
    return sendRedirect(event, `${platformConfig().siteScheme}://${site.host}${back}`, 302)
  }
  if (await isOwnSite(userId, site.orgId)) return sendRedirect(event, await handoffUrl(userId, site.host, back), 302)
  return myRedirect(event, { confirm: site.host, return: back })
}

// `/my/admin?to=<admin path>`: opens the admin app signed in as the person.
// Only a sign-in from the last day opens it; an older one asks for a fresh
// email link first. The admin session keeps the sign-in's time, so it counts
// as recently authenticated only as long as that sign-in does.
export async function continueToAdmin(event: H3Event) {
  const userId = await sessionUserId(event)
  if (!userId) return continueLater(event)
  const signedInAt = (await sessionSignedInAt(event))!
  if (Date.now() - signedInAt.getTime() > ADMIN_SIGN_IN_HOURS * 3_600_000) return myRedirect(event, { notice: 'reauth', continue: event.path })
  const code = await issueAuthCode(useDb(), { userId, purpose: 'handoff', host: adminHost(), ttlMs: HANDOFF_SECONDS * 1000, authenticatedAt: signedInAt })
  const to = safeReturnPath(getQuery(event).to)
  return sendRedirect(event, `${new URL(platformConfig().adminUrl).origin}/api/pt/handoff?code=${encodeURIComponent(code)}&to=${encodeURIComponent(to)}`, 302)
}

// Site host `/account/sign-in?return=<path>`: signing in happens on the
// platform host, which hands the sign-in back.
export function signInFromSite(event: H3Event, ctx: SiteContext) {
  const back = safeReturnPath(getQuery(event).return)
  return sendRedirect(event, `${platformOrigin()}/my/continue?host=${encodeURIComponent(ctx.host)}&return=${encodeURIComponent(back)}`, 302)
}

// Site host `/account/claim/<code>`: the hand-off from the platform host.
export async function claimHandoff(event: H3Event, ctx: SiteContext, code: string) {
  const row = await takeAuthCode(useDb(), code, 'handoff', ctx.host)
  const back = safeReturnPath(getQuery(event).return)
  if (row) await startAccountSession(event, row.user_id)
  return sendRedirect(event, back, 302)
}
