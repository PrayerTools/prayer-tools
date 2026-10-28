// Platform configuration from the environment. Every process (admin app,
// public server, worker) reads the same variables.
function env(name: string, fallback = ''): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

function required(name: string): string {
  const v = env(name)
  if (!v) throw new Error(`${name} is not set`)
  return v
}

export interface PlatformConfig {
  // Host that sites live under: `{slug}.<siteBaseHost>`. `prayer.tools` in
  // production, `localhost:3380` in development.
  siteBaseHost: string
  // Scheme sites are served on.
  siteScheme: 'https' | 'http'
  // The platform host serving the My prayer page (`prayer.tools`).
  platformHost: string
  adminUrl: string
  apiHost: string
  goHost: string
  secret: string
  // Behind a proxy that sets X-Forwarded-Host / -Proto / -For and
  // CF-Connecting-IP (PT_TRUST_PROXY=true); otherwise those headers are ignored.
  trustProxy: boolean
  statinator: { url: string, projectId: string, apiKey: string }
  turnstileSecret: string
  cloudflare: { apiToken: string, zoneId: string, fallbackOrigin: string }
  donateUrl: string
  appStoreUrl: string
  playStoreUrl: string
  feedback: { apiBase: string, projectId: string }
  // The inbox layer's shared inbound domain; with `slugAddresses` every site's
  // inbox is `<slug>@<domain>`.
  inbox: { domain: string, slugAddresses: boolean }
}

export function platformConfig(): PlatformConfig {
  const siteBaseHost = env('PT_SITE_BASE_HOST', 'localhost:3380')
  const siteScheme = env('PT_SITE_SCHEME', siteBaseHost.startsWith('localhost') ? 'http' : 'https') as 'https' | 'http'
  return {
    siteBaseHost,
    siteScheme,
    platformHost: env('PT_PLATFORM_HOST', siteBaseHost),
    adminUrl: env('PT_ADMIN_URL', 'http://localhost:2380'),
    apiHost: env('PT_API_HOST', `api.${siteBaseHost}`),
    goHost: env('PT_GO_HOST', `go.${siteBaseHost}`),
    secret: required('PT_SECRET'),
    trustProxy: env('PT_TRUST_PROXY') === 'true',
    statinator: {
      url: env('STATINATOR_URL'),
      projectId: env('STATINATOR_PROJECT_ID', 'prayer_tools_campaigns'),
      apiKey: env('STATINATOR_API_KEY')
    },
    turnstileSecret: env('TURNSTILE_SECRET_KEY'),
    cloudflare: {
      apiToken: env('CLOUDFLARE_API_TOKEN'),
      zoneId: env('CLOUDFLARE_ZONE_ID'),
      fallbackOrigin: env('CLOUDFLARE_FALLBACK_ORIGIN', 'sites.prayer.tools')
    },
    donateUrl: env('PT_DONATE_URL', 'https://prayer.tools/give'),
    appStoreUrl: env('PT_APP_STORE_URL'),
    playStoreUrl: env('PT_PLAY_STORE_URL'),
    feedback: { apiBase: env('PT_FEEDBACK_API_BASE', 'https://apps.gospelambition.org'), projectId: env('PT_FEEDBACK_PROJECT_ID') },
    inbox: { domain: env('INBOX_DOMAIN').toLowerCase(), slugAddresses: env('INBOX_SLUG_ADDRESSES') === 'true' }
  }
}

export function platformOrigin(): string {
  const c = platformConfig()
  return `${c.siteScheme}://${c.platformHost}`
}

export function apiOrigin(): string {
  const c = platformConfig()
  return `${c.siteScheme}://${c.apiHost}`
}

export function goOrigin(): string {
  const c = platformConfig()
  return `${c.siteScheme}://${c.goHost}`
}

// Slugs that can never be sites: platform hosts and common infrastructure names.
export const RESERVED_SLUGS = new Set([
  'app', 'api', 'go', 'www', 'my', 'admin', 'mail', 'email', 'smtp', 'ftp', 'static', 'assets', 'cdn',
  'help', 'support', 'docs', 'blog', 'status', 'staging', 'dev', 'test', 'sites', 'site', 'prayer',
  'prayertools', 'tools', 'give', 'donate', 'login', 'account', 'dashboard', 'statinator', 'feedback',
  'news', 'webmail', 'ns1', 'ns2', 'mx', 'autodiscover', 'autoconfig', 'img', 'images', 'media',
  // Mail role addresses: a site's slug is also its inbox address on the shared inbound domain.
  'abuse', 'bounce', 'contact', 'hostmaster', 'mailer-daemon', 'no-reply', 'noreply', 'notifications', 'postmaster', 'security', 'webmaster'
])

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export function slugError(slug: string): string | null {
  if (!SLUG_RE.test(slug) || slug.length < 3) return 'invalid'
  if (slug.includes('--')) return 'invalid'
  if (RESERVED_SLUGS.has(slug)) return 'reserved'
  return null
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
