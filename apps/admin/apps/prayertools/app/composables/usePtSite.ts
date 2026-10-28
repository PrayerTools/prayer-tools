import type { TranslatableText } from '@prayertools/shared/db/schema'

export interface PtLanguage { code: string, name: string, native: string, dir: 'ltr' | 'rtl' }

export interface PtMeta {
  languages: PtLanguage[]
  uiLanguages: string[]
  templates: { key: string, setup: Record<string, unknown>, open: string[], topics: string[], hiddenSections: string[], cta: string }[]
  setup: { startModes: string[], endModes: string[], goals: string[], cadences: string[], durations: number[], defaultDuration: number, slotOptions: number[], defaultSlot: number, fixedMaxDays: number }
  landing: { sections: string[], hideable: string[] }
  licenses: string[]
  settingDefaults: Record<string, boolean | number>
  siteBaseHost: string
  siteScheme: string
  donateUrl: string
  fallbackOrigin: string
  turnstileSiteKey: string
  feedback: { apiBase: string, projectId: string }
}

export interface PtSiteResponse {
  site: {
    org_id: string
    status: 'draft' | 'published' | 'archived'
    description: TranslatableText | null
    purpose: string | null
    languages: string[]
    default_language: string
    timezone: string
    branding: Record<string, any>
    email_identity: Record<string, any>
    settings: Record<string, any>
    overrides: Record<string, any>
    onboarding: { step?: string, completed?: boolean }
    template_key: string | null
    published_at: string | null
    archived_at: string | null
  }
  org: { id: string, slug: string, name: string }
  // Where replies land when the site sets no reply-to.
  inboxAddress: string | null
  url: string
  subdomainUrl: string
  brand: { color: string, textColor: string, tooPale: boolean }
  domains: { id: string, hostname: string, status: string, verification: any, last_checked_at: string | null, activated_at: string | null }[]
  directory: { status: string, requested_at: string | null, reviewed_at: string | null } | null
  currentCampaign: (Record<string, any> & { state: string }) | null
  campaignCount: number
  roles: string[]
  perms: string[]
}

export function usePtMeta() {
  return useFetch<PtMeta>('/api/pt/meta', { key: 'pt-meta', dedupe: 'defer', getCachedData: (key, nuxt) => nuxt.payload.data[key] ?? nuxt.static.data[key] })
}

// The active site. Keyed per org slug so switching sites refetches.
export function usePtSite() {
  const route = useRoute()
  const slug = computed(() => String(route.params.orgSlug ?? ''))
  const res = useFetch<PtSiteResponse>('/api/pt/site', { key: computed(() => `pt-site-${slug.value}`), watch: [slug] })
  const can = (perm: string) => !!res.data.value?.perms.includes(perm)
  const isOwner = computed(() => !!res.data.value?.roles.includes('admin'))
  return { ...res, can, isOwner, slug }
}

export function languageName(meta: PtMeta | null | undefined, code: string): string {
  return meta?.languages.find(l => l.code === code)?.name ?? code
}

export function ptErrorMessage(err: unknown): string {
  const e = err as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
  return e?.data?.statusMessage || e?.statusMessage || e?.data?.message || e?.message || 'Something went wrong.'
}

export function usePtToast() {
  const toast = useToast()
  return {
    ok: (title: string, description?: string) => toast.add({ title, description, color: 'success', icon: 'i-lucide-check' }),
    fail: (err: unknown, title = 'Could not save') => toast.add({ title, description: ptErrorMessage(err), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
