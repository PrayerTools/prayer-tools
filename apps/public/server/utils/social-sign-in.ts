// Google and Apple sign-in, run on the platform host only, so each provider
// needs one return URL whichever site the person started from; sites get
// the sign-in back through `/my/continue`. The flow's state, nonce and
// (Google) PKCE verifier ride in a signed cookie that lasts ten minutes.
import type { H3Event } from 'h3'
import { createHash } from 'node:crypto'
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose'
import { platformConfig, platformOrigin } from '@prayertools/shared/config'
import { randomToken, signJson, verifySignedJson } from '@prayertools/shared/tokens'
import { safeReturnPath } from '@prayertools/shared/auth-codes'
import { accountForIdentity, type IdentityProfile } from '@prayertools/shared/accounts'
import { useDb } from './db'
import { startAccountSession } from './account-session'
import { limit, requestScheme } from './request'

export type SocialProvider = 'google' | 'apple'

const FLOW_COOKIE = 'pt_social'
const FLOW_SECONDS = 600
const CANCELLED = new Set(['access_denied', 'user_cancelled_authorize'])
const jwks = {
  google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
  apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
}

interface Flow {
  provider: SocialProvider
  state: string
  nonce: string
  verifier: string
  next: string
  expires: number
}

type Params = Record<string, unknown>

export function socialProviders(): Record<SocialProvider, boolean> {
  const e = process.env
  return {
    google: !!(e.NUXT_SOCIAL_AUTH_GOOGLE_CLIENT_ID && e.NUXT_SOCIAL_AUTH_GOOGLE_CLIENT_SECRET),
    apple: !!(e.NUXT_SOCIAL_AUTH_APPLE_SERVICES_ID && e.NUXT_SOCIAL_AUTH_APPLE_TEAM_ID && e.NUXT_SOCIAL_AUTH_APPLE_KEY_ID && e.NUXT_SOCIAL_AUTH_APPLE_PRIVATE_KEY)
  }
}

export function isSocialProvider(value: unknown): value is SocialProvider {
  return value === 'google' || value === 'apple'
}

function redirectUri(provider: SocialProvider): string {
  return `${platformOrigin()}/my/${provider}/callback`
}

function cookieOptions(event: H3Event, provider: SocialProvider) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: requestScheme(event) === 'https', path: `/my/${provider}` }
}

// Where to go once signed in: My prayer, or a hand-off from it.
function myPath(value: unknown): string {
  const path = safeReturnPath(value, '/my')
  return path.startsWith('/my') ? path : '/my'
}

// `/my/<provider>?continue=<path>`
export function startSocialSignIn(event: H3Event, provider: SocialProvider) {
  const next = myPath(getQuery(event).continue)
  if (!socialProviders()[provider]) return sendRedirect(event, next, 302)
  const flow: Flow = { provider, state: randomToken(16), nonce: randomToken(16), verifier: randomToken(32), next, expires: Date.now() + FLOW_SECONDS * 1000 }
  setCookie(event, FLOW_COOKIE, signJson(flow, platformConfig().secret), { ...cookieOptions(event, provider), maxAge: FLOW_SECONDS })
  if (provider === 'google') {
    const q = new URLSearchParams({
      client_id: process.env.NUXT_SOCIAL_AUTH_GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri('google'),
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account'
    })
    return sendRedirect(event, `https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302)
  }
  // Asking for name and email makes Apple return with a form POST.
  const q = new URLSearchParams({
    client_id: process.env.NUXT_SOCIAL_AUTH_APPLE_SERVICES_ID!,
    redirect_uri: redirectUri('apple'),
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state: flow.state,
    nonce: flow.nonce
  })
  return sendRedirect(event, `https://appleid.apple.com/auth/authorize?${q}`, 302)
}

// `/my/<provider>/callback`: signs the person in to the account for their
// identity and goes on to where the flow was headed.
export async function finishSocialSignIn(event: H3Event, provider: SocialProvider) {
  limit(event, 'my-social', 20, 60_000)
  const params: Params = event.method === 'POST' ? (await readBody<Params>(event).catch(() => null) ?? {}) : getQuery(event)
  const cookie = getCookie(event, FLOW_COOKIE)
  // Apple's cross-site POST arrives without the SameSite=Lax flow cookie;
  // posting the same fields again from this host brings it along.
  if (event.method === 'POST' && !cookie && params.resubmit !== '1') return resubmitPage(event, provider, params)
  const flow = verifySignedJson<Flow>(cookie, platformConfig().secret)
  deleteCookie(event, FLOW_COOKIE, cookieOptions(event, provider))
  if (!flow || flow.provider !== provider || flow.expires < Date.now()) return backToMy(event, '/my', 'social_failed')
  if (typeof params.error === 'string' && CANCELLED.has(params.error)) return backToMy(event, flow.next, null)
  if (typeof params.code !== 'string' || params.state !== flow.state) return backToMy(event, flow.next, 'social_failed')
  const profile = await (provider === 'google' ? googleProfile(params.code, flow) : appleProfile(params.code, params.user, flow)).catch(() => null)
  if (!profile) return backToMy(event, flow.next, 'social_failed')
  const account = await accountForIdentity(useDb(), provider, profile)
  await startAccountSession(event, account.id)
  return sendRedirect(event, flow.next, 302)
}

function backToMy(event: H3Event, next: string, notice: string | null) {
  const q = new URLSearchParams()
  if (notice) q.set('notice', notice)
  if (next !== '/my') q.set('continue', next)
  return sendRedirect(event, q.size ? `/my?${q}` : '/my', 302)
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function resubmitPage(event: H3Event, provider: SocialProvider, params: Params) {
  const fields = ['code', 'state', 'user', 'error']
    .filter(k => typeof params[k] === 'string')
    .map(k => `<input type="hidden" name="${k}" value="${escapeAttr(params[k] as string)}">`)
    .join('')
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Prayer.Tools</title><form method="post" action="/my/${provider}/callback"><input type="hidden" name="resubmit" value="1">${fields}<noscript><button type="submit">Continue</button></noscript></form><script>document.forms[0].submit()</script>`
}

async function verifiedProfile(provider: SocialProvider, idToken: string, flow: Flow, audience: string, issuer: string[]): Promise<{ subject: string, email: string, claims: Record<string, unknown> } | null> {
  const { payload } = await jwtVerify(idToken, jwks[provider], { issuer, audience })
  // Apple sends booleans as strings.
  const verified = payload.email_verified === true || payload.email_verified === 'true'
  if (payload.nonce !== flow.nonce || !verified) return null
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
  return { subject: payload.sub, email: payload.email, claims: payload }
}

function firstName(...names: unknown[]): string | null {
  const name = names.find((n): n is string => typeof n === 'string' && !!n.trim())
  return name?.trim() ?? null
}

async function tokenRequest(url: string, body: Record<string, string>): Promise<string | null> {
  const res = await $fetch<{ id_token?: string }>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  return res.id_token ?? null
}

async function googleProfile(code: string, flow: Flow): Promise<IdentityProfile | null> {
  const clientId = process.env.NUXT_SOCIAL_AUTH_GOOGLE_CLIENT_ID!
  const idToken = await tokenRequest('https://oauth2.googleapis.com/token', {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: process.env.NUXT_SOCIAL_AUTH_GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri('google'),
    code_verifier: flow.verifier
  })
  if (!idToken) return null
  const p = await verifiedProfile('google', idToken, flow, clientId, ['https://accounts.google.com', 'accounts.google.com'])
  return p && { subject: p.subject, email: p.email, name: firstName(p.claims.given_name, p.claims.name) }
}

// Apple's client secret: a short-lived ES256 JWT signed with the team's key.
async function appleClientSecret(): Promise<string> {
  const key = await importPKCS8(process.env.NUXT_SOCIAL_AUTH_APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'ES256')
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.NUXT_SOCIAL_AUTH_APPLE_KEY_ID! })
    .setIssuer(process.env.NUXT_SOCIAL_AUTH_APPLE_TEAM_ID!)
    .setSubject(process.env.NUXT_SOCIAL_AUTH_APPLE_SERVICES_ID!)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

// Apple sends the person's name only on their first sign-in, in `user`.
async function appleProfile(code: string, user: unknown, flow: Flow): Promise<IdentityProfile | null> {
  const clientId = process.env.NUXT_SOCIAL_AUTH_APPLE_SERVICES_ID!
  const idToken = await tokenRequest('https://appleid.apple.com/auth/token', {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: await appleClientSecret(),
    redirect_uri: redirectUri('apple')
  })
  if (!idToken) return null
  const p = await verifiedProfile('apple', idToken, flow, clientId, ['https://appleid.apple.com'])
  if (!p) return null
  let name: string | null = null
  try {
    const parsed = typeof user === 'string' ? JSON.parse(user) as { name?: { firstName?: unknown } } : null
    name = firstName(parsed?.name?.firstName)
  } catch {
    // no name sent
  }
  return { subject: p.subject, email: p.email, name }
}
