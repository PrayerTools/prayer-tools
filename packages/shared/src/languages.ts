// The languages a site can run in. The list lives in code; a site stores only
// its chosen subset and default.
export interface Language {
  code: string
  name: string
  native: string
  dir: 'ltr' | 'rtl'
  // circle-flags icon shown beside the language in pickers.
  flag: string
  // bolls.life translation used for Scripture lookups in this language.
  bible?: string
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', native: 'English', flag: 'lang-en', dir: 'ltr', bible: 'NIV' },
  { code: 'es', name: 'Spanish', native: 'Español', flag: 'lang-es', dir: 'ltr', bible: 'NVI' },
  { code: 'fr', name: 'French', native: 'Français', flag: 'lang-fr', dir: 'ltr', bible: 'LSG' },
  { code: 'pt', name: 'Portuguese', native: 'Português', flag: 'lang-pt', dir: 'ltr', bible: 'NVIPT' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: 'lang-de', dir: 'ltr', bible: 'LUT' },
  { code: 'it', name: 'Italian', native: 'Italiano', flag: 'lang-it', dir: 'ltr', bible: 'NR06' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', flag: 'lang-nl', dir: 'ltr', bible: 'HSV' },
  { code: 'ro', name: 'Romanian', native: 'Română', flag: 'lang-ro', dir: 'ltr', bible: 'RMNN' },
  { code: 'ru', name: 'Russian', native: 'Русский', flag: 'lang-ru', dir: 'ltr', bible: 'SYNOD' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', flag: 'lang-uk', dir: 'ltr', bible: 'UBIO' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', flag: 'lang-tr', dir: 'ltr', bible: 'TCL02' },
  { code: 'ar', name: 'Arabic', native: 'العربية', flag: 'lang-ar', dir: 'rtl', bible: 'SVD' },
  { code: 'fa', name: 'Persian', native: 'فارسی', flag: 'lang-fa', dir: 'rtl', bible: 'TPV' },
  { code: 'ur', name: 'Urdu', native: 'اردو', flag: 'lang-ur', dir: 'rtl' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: 'lang-hi', dir: 'ltr', bible: 'HHBD' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', flag: 'lang-bn', dir: 'ltr' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', flag: 'lang-ne', dir: 'ltr' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', flag: 'lang-id', dir: 'ltr', bible: 'TB' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', flag: 'lang-sw', dir: 'ltr', bible: 'SUV' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ', flag: 'lang-am', dir: 'ltr' },
  { code: 'zh-hans', name: 'Chinese (Simplified)', native: '简体中文', flag: 'cn', dir: 'ltr', bible: 'CUNPSS' },
  { code: 'zh-hant', name: 'Chinese (Traditional)', native: '繁體中文', flag: 'tw', dir: 'ltr', bible: 'CUNP' },
  { code: 'ko', name: 'Korean', native: '한국어', flag: 'lang-ko', dir: 'ltr', bible: 'KRV' },
  { code: 'ja', name: 'Japanese', native: '日本語', flag: 'lang-ja', dir: 'ltr', bible: 'JC' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', flag: 'lang-vi', dir: 'ltr', bible: 'VI1934' }
]

// Languages the public site's interface and emails are translated into. A site
// can run in any of LANGUAGES; the others fall back to English for interface text.
export const UI_LANGUAGES: readonly string[] = ['en', 'es', 'fr', 'pt', 'ar']

const BY_CODE = new Map(LANGUAGES.map(l => [l.code, l]))

export function getLanguage(code: string | null | undefined): Language | undefined {
  return code ? BY_CODE.get(code) : undefined
}

// Iconify name of the language's flag, for item icons in Nuxt UI menus.
export function languageFlag(code: string | null | undefined): string {
  const flag = code ? BY_CODE.get(code)?.flag : undefined
  return flag ? `i-circle-flags-${flag}` : 'i-lucide-languages'
}

export function isLanguage(code: unknown): code is string {
  return typeof code === 'string' && BY_CODE.has(code)
}

export function languageDir(code: string): 'ltr' | 'rtl' {
  return BY_CODE.get(code)?.dir ?? 'ltr'
}

// Picks the language to serve: the wanted one when the site offers it,
// otherwise the site's default.
export function pickLanguage(wanted: string | null | undefined, siteLanguages: string[], siteDefault: string): string {
  if (wanted && siteLanguages.includes(wanted)) return wanted
  if (wanted) {
    const base = wanted.toLowerCase().split(/[-_]/)[0]
    const match = siteLanguages.find(l => l === base || l.split('-')[0] === base)
    if (match) return match
  }
  return siteDefault
}

// Best match from an Accept-Language header among the site's languages.
export function negotiateLanguage(acceptLanguage: string | null | undefined, siteLanguages: string[], siteDefault: string): string {
  if (!acceptLanguage) return siteDefault
  const wanted = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=')
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q) : 1 }
    })
    .filter(x => x.tag && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q)
  for (const { tag } of wanted) {
    if (tag === 'zh-tw' || tag === 'zh-hk' || tag.startsWith('zh-hant')) {
      if (siteLanguages.includes('zh-hant')) return 'zh-hant'
    }
    if (tag.startsWith('zh')) {
      if (siteLanguages.includes('zh-hans')) return 'zh-hans'
    }
    const picked = pickLanguage(tag, siteLanguages, '')
    if (picked) return picked
  }
  return siteDefault
}
