// Browser sign-in (OAuth authorization code with PKCE and a callback on a
// random 127.0.0.1 port) and an API client that refreshes its token.
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { deleteTokens, getProfile, loadTokens, saveProfile, saveTokens, type Profile, type Tokens } from './store'

export const OPERATOR_SCOPE = 'pt.operator.libraries'
const SCOPES = `${OPERATOR_SCOPE} offline_access`
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export class CliError extends Error {}

interface Discovery {
  resource: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { headers: { accept: 'application/json' } }).catch(() => null)
  if (!res) throw new CliError(`Can't reach ${new URL(url).origin}. Is the admin app running?`)
  if (!res.ok) return null
  return await res.json().catch(() => null) as Record<string, unknown> | null
}

async function discover(url: string): Promise<Discovery> {
  const notEnabled = `${url} doesn't offer OAuth sign-in. On the admin app set OAUTH_CONSENT_COOKIE_SECRET (32+ characters) and OAUTH_ALLOW_DCR=true, then restart it.`
  const resource = await getJson(`${url}/.well-known/oauth-protected-resource`)
  const issuer = Array.isArray(resource?.authorization_servers) ? String(resource.authorization_servers[0]) : null
  if (!resource || !issuer) throw new CliError(notEnabled)
  const scopes = Array.isArray(resource.scopes_supported) ? resource.scopes_supported as string[] : []
  if (!scopes.includes(OPERATOR_SCOPE)) throw new CliError(`${url} doesn't offer the ${OPERATOR_SCOPE} scope yet; it needs a newer prayer.tools admin.`)
  const server = await getJson(`${issuer}/.well-known/oauth-authorization-server`)
  if (!server) throw new CliError(notEnabled)
  return {
    resource: String(resource.resource),
    authorizationEndpoint: String(server.authorization_endpoint),
    tokenEndpoint: String(server.token_endpoint),
    registrationEndpoint: server.registration_endpoint ? String(server.registration_endpoint) : undefined
  }
}

async function registerClient(d: Discovery, url: string): Promise<string> {
  if (!d.registrationEndpoint) throw new CliError(`${url} doesn't allow new OAuth clients. Set OAUTH_ALLOW_DCR=true on the admin app.`)
  const res = await fetch(d.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'prayer.tools CLI', redirect_uris: ['http://127.0.0.1/callback'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none', scope: SCOPES })
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || typeof body.client_id !== 'string') throw new CliError(`Couldn't register the CLI with ${url}: ${body.error_description ?? res.statusText}`)
  return body.client_id
}

async function tokenRequest(d: Discovery, params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(d.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, resource: d.resource }).toString()
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || typeof body.access_token !== 'string') {
    const err = new CliError(String(body.error_description ?? body.error ?? res.statusText))
    ;(err as CliError & { code?: string }).code = String(body.error ?? '')
    throw err
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    scope: String(body.scope ?? '')
  }
}

const base64url = (b: Buffer) => b.toString('base64url')

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

function page(title: string, text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></body>`
}

// Waits for the browser to come back to the callback with a code.
function waitForCode(state: string): Promise<{ port: number, code: Promise<string>, close: () => void }> {
  return new Promise((resolveServer, rejectServer) => {
    let resolveCode!: (code: string) => void
    let rejectCode!: (err: Error) => void
    const code = new Promise<string>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (u.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const error = u.searchParams.get('error')
      if (u.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(page('Sign-in failed', 'This sign-in link is out of date. Run pt login again.'))
        return
      }
      if (error) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(page('Sign-in cancelled', 'You can close this tab.'))
        rejectCode(new CliError(`Sign-in was not completed: ${u.searchParams.get('error_description') ?? error}`))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(page('Signed in to the prayer.tools CLI', 'You can close this tab and go back to the terminal.'))
      resolveCode(u.searchParams.get('code') ?? '')
    })
    const timer = setTimeout(() => rejectCode(new CliError('Sign-in timed out after 5 minutes.')), LOGIN_TIMEOUT_MS)
    const close = () => {
      clearTimeout(timer)
      server.close()
    }
    server.on('error', rejectServer)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolveServer({ port: typeof addr === 'object' && addr ? addr.port : 0, code, close })
    })
  })
}

export async function login(profileName: string, urlArg: string | undefined, opts: { browser: boolean } = { browser: true }): Promise<Profile> {
  const known = getProfile(profileName)
  const url = (urlArg ?? known?.url)?.replace(/\/+$/, '')
  if (!url) throw new CliError(`Give the admin URL the first time: pt login ${profileName} https://admin.example.org`)
  const d = await discover(url)
  const clientId = known?.url === url && known.clientId ? known.clientId : await registerClient(d, url)
  saveProfile(profileName, { url, clientId })

  const state = base64url(randomBytes(16))
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const callback = await waitForCode(state)
  const redirectUri = `http://127.0.0.1:${callback.port}/callback`
  const authUrl = new URL(d.authorizationEndpoint)
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', resource: d.resource })) {
    authUrl.searchParams.set(k, v)
  }
  if (opts.browser) {
    console.log(`Opening your browser to sign in to ${url}.\nIf it doesn't open, visit:\n  ${authUrl}\n`)
    openBrowser(authUrl.toString())
  } else {
    console.log(`Open this link in a browser on this computer to sign in to ${url}:\n  ${authUrl}\n`)
  }
  let code: string
  try {
    code = await callback.code
  } finally {
    callback.close()
  }
  const tokens = await tokenRequest(d, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier })
  if (!tokens.scope.split(' ').includes(OPERATOR_SCOPE)) {
    throw new CliError('Signed in, but the "Manage platform libraries" permission wasn\'t granted. Run pt login again and tick it, or add it under Connected apps.')
  }
  saveTokens(profileName, url, tokens)
  return { url, clientId }
}

export function logout(profileName: string): Profile | null {
  const profile = getProfile(profileName)
  if (profile) deleteTokens(profileName, profile.url)
  return profile
}

export interface ApiError extends CliError {
  status: number
  data?: Record<string, unknown>
}

// Calls the admin API as the profile's signed-in user, refreshing the token
// when it is about to expire or the server turns it down.
export class Api {
  readonly url: string
  private discovery: Discovery | null = null

  constructor(readonly profileName: string, readonly profile: Profile) {
    this.url = profile.url
  }

  static for(profileName: string): Api {
    const profile = getProfile(profileName)
    if (!profile || !loadTokens(profileName, profile.url)) {
      throw new CliError(`Not signed in to ${profileName === 'local' ? 'local' : `"${profileName}"`}. Run: pt login${profileName === 'local' ? '' : ` ${profileName} <admin url>`}`)
    }
    return new Api(profileName, profile)
  }

  private async refresh(tokens: Tokens): Promise<Tokens> {
    const expired = new CliError(`Your sign-in to ${this.url} has expired. Run: pt login${this.profileName === 'local' ? '' : ` ${this.profileName}`}`)
    if (!tokens.refreshToken || !this.profile.clientId) throw expired
    this.discovery ??= await discover(this.url)
    try {
      const next = await tokenRequest(this.discovery, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: this.profile.clientId })
      next.refreshToken ??= tokens.refreshToken
      saveTokens(this.profileName, this.url, next)
      return next
    } catch {
      throw expired
    }
  }

  async request<T>(method: string, path: string, body?: BodyInit): Promise<T> {
    let tokens = loadTokens(this.profileName, this.url)
    if (!tokens) throw new CliError(`Not signed in. Run: pt login${this.profileName === 'local' ? '' : ` ${this.profileName}`}`)
    if (tokens.expiresAt - Date.now() < 60_000) tokens = await this.refresh(tokens)
    const send = (t: Tokens) => fetch(`${this.url}${path}`, { method, body, headers: { authorization: `Bearer ${t.accessToken}`, accept: 'application/json' } })
      .catch(() => { throw new CliError(`Can't reach ${this.url}. Is the admin app running?`) })
    let res = await send(tokens)
    if (res.status === 401) res = await send(await this.refresh(tokens))
    const data = await res.json().catch(() => null) as Record<string, unknown> | null
    if (!res.ok) {
      const message = String(data?.statusMessage ?? data?.message ?? res.statusText)
      const err = new CliError(res.status === 403 && message === 'Operator admin required' ? 'This account isn\'t a prayer.tools operator.' : message) as ApiError
      err.status = res.status
      err.data = data?.data as Record<string, unknown> | undefined
      throw err
    }
    return data as T
  }
}
