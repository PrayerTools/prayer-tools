// Profiles (a server URL and the OAuth client registered there) live in
// ~/.config/prayertools/cli.json. Tokens go to the OS keychain (macOS
// `security`, Linux `secret-tool`) when one is available, else to
// credentials.json beside it, readable only by the user.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LOCAL_URL = 'http://localhost:3030'
const SERVICE = 'prayertools-cli'

export interface Profile {
  url: string
  clientId?: string
}

export interface Tokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scope: string
}

function configDir(): string {
  const dir = process.env.PT_CLI_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'prayertools')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
}

const profilesFile = () => join(configDir(), 'cli.json')
const credentialsFile = () => join(configDir(), 'credentials.json')

export function getProfile(name: string): Profile | null {
  const profiles = readJson<{ profiles?: Record<string, Profile> }>(profilesFile(), {}).profiles ?? {}
  return profiles[name] ?? (name === 'local' ? { url: LOCAL_URL } : null)
}

export function saveProfile(name: string, profile: Profile): void {
  const data = readJson<{ profiles?: Record<string, Profile> }>(profilesFile(), {})
  data.profiles = { ...data.profiles, [name]: profile }
  writeJson(profilesFile(), data)
}

type Keychain = 'macos' | 'secret-tool' | null
let keychain: Keychain | undefined

function which(cmd: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0
}

function detectKeychain(): Keychain {
  if (process.env.PT_CLI_NO_KEYCHAIN) return null
  if (keychain !== undefined) return keychain
  keychain = process.platform === 'darwin' && which('security')
    ? 'macos'
    : process.platform === 'linux' && which('secret-tool') && process.env.DBUS_SESSION_BUS_ADDRESS ? 'secret-tool' : null
  return keychain
}

let warnedFallback = false
function noteFallback(): void {
  if (warnedFallback) return
  warnedFallback = true
  console.error(`No keychain available; tokens are kept in ${credentialsFile()} (readable only by you).`)
}

function keychainRead(kind: Keychain, account: string): string | null {
  const res = kind === 'macos'
    ? spawnSync('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], { encoding: 'utf8' })
    : spawnSync('secret-tool', ['lookup', 'service', SERVICE, 'account', account], { encoding: 'utf8' })
  return res.status === 0 && res.stdout.trim() ? res.stdout.trim() : null
}

function keychainWrite(kind: Keychain, account: string, secret: string): boolean {
  const res = kind === 'macos'
    ? spawnSync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', secret], { stdio: 'ignore' })
    : spawnSync('secret-tool', ['store', '--label', `prayer.tools CLI (${account})`, 'service', SERVICE, 'account', account], { input: secret, stdio: ['pipe', 'ignore', 'ignore'] })
  return res.status === 0
}

function keychainDelete(kind: Keychain, account: string): void {
  if (kind === 'macos') spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore' })
  else spawnSync('secret-tool', ['clear', 'service', SERVICE, 'account', account], { stdio: 'ignore' })
}

const accountFor = (profile: string, url: string) => `${profile}:${url}`

export function loadTokens(profile: string, url: string): Tokens | null {
  const account = accountFor(profile, url)
  const kind = detectKeychain()
  const raw = kind ? keychainRead(kind, account) : null
  if (raw) {
    try {
      return JSON.parse(raw) as Tokens
    } catch {
      return null
    }
  }
  return readJson<Record<string, Tokens>>(credentialsFile(), {})[account] ?? null
}

export function saveTokens(profile: string, url: string, tokens: Tokens): void {
  const account = accountFor(profile, url)
  const kind = detectKeychain()
  if (kind && keychainWrite(kind, account, JSON.stringify(tokens))) return
  noteFallback()
  const all = readJson<Record<string, Tokens>>(credentialsFile(), {})
  all[account] = tokens
  writeJson(credentialsFile(), all)
}

export function deleteTokens(profile: string, url: string): void {
  const account = accountFor(profile, url)
  const kind = detectKeychain()
  if (kind) keychainDelete(kind, account)
  const all = readJson<Record<string, Tokens>>(credentialsFile(), {})
  if (account in all) {
    delete all[account]
    writeJson(credentialsFile(), all)
  }
}
