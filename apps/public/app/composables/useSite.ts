import type { InjectionKey, Ref } from 'vue'
import { sitePath } from '@prayertools/shared/paths'
import type { SiteView } from '~~/shared/view'

export const SITE_KEY: InjectionKey<Ref<SiteView>> = Symbol('site')

// Site context for components: links in the site's URL shape, per-site
// string overrides over the i18n defaults, and Intl formatting in the
// page language.
export function useSite() {
  const site = inject(SITE_KEY)!
  const { t } = useI18n()

  function link(page = '', rest: (string | number)[] = [], opts: { lang?: string, current?: boolean } = {}): string {
    return sitePath({
      lang: opts.lang ?? site.value.lang,
      defaultLang: site.value.defaultLanguage,
      campaignSlug: opts.current ? null : site.value.campaignSegment,
      page,
      rest
    })
  }

  function campaignLink(slug: string, page = ''): string {
    return sitePath({ lang: site.value.lang, defaultLang: site.value.defaultLanguage, campaignSlug: slug, page })
  }

  function st(key: string, params?: Record<string, unknown>): string {
    const override = site.value.strings[key]
    if (override) return override.replace(/\{(\w+)\}/g, (m, k: string) => (params && k in params ? String(params[k]) : m))
    return params ? t(key, params) : t(key)
  }

  function num(n: number): string {
    return new Intl.NumberFormat(site.value.lang).format(n)
  }

  function minutes(n: number): string {
    try {
      return new Intl.NumberFormat(site.value.lang, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(n)
    } catch {
      return `${n} min`
    }
  }

  function date(iso: string | null): string {
    if (!iso) return ''
    return new Intl.DateTimeFormat(site.value.lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
  }

  function shareUrl(referral?: string | null): string {
    const base = `${site.value.url}${link('', [], { current: !site.value.campaign?.side })}`.replace(/\/$/, '') || site.value.url
    return referral ? `${base}${base.includes('?') ? '&' : '?'}r=${encodeURIComponent(referral)}` : base
  }

  function shareText(): string {
    return site.value.shareMessage || st('share.default_message', { site: site.value.name })
  }

  return { site, link, campaignLink, st, num, minutes, date, shareUrl, shareText }
}
