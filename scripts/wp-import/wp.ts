// Read access to the WordPress multisite's MySQL / MariaDB database: table
// names per subsite, post meta, and PHP's serialize() format.
import { SQL } from 'bun'

export const WP_PREFIX = process.env.WP_TABLE_PREFIX || 'X6Jywh_'

export function connectWp(url = process.env.WP_DATABASE_URL || 'mysql://root:dev@127.0.0.1:3307/wp_prod'): SQL {
  return new SQL(url)
}

// `posts` → `X6Jywh_32_posts` for subsite 32; the main site (1) has no number.
export function table(blogId: number, name: string): string {
  return blogId === 1 ? `${WP_PREFIX}${name}` : `${WP_PREFIX}${blogId}_${name}`
}

export function networkTable(name: string): string {
  return `${WP_PREFIX}${name}`
}

export async function tableExists(wp: SQL, name: string): Promise<boolean> {
  const rows = await wp.unsafe(`SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, [name])
  return rows.length > 0
}

// DATETIME columns arrive as Dates read as UTC; strings are accepted too.
export function wpDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(`${v.replace(' ', 'T')}Z`)
}

// WordPress leaves post_date_gmt zero on some posts; the local date, else now, stands in.
export interface WpPost {
  ID: number
  post_author: number
  post_date_gmt: Date
  post_modified_gmt: Date
  post_content: string
  post_title: string
  post_status: string
  post_name: string
  post_type: string
  post_parent: number
}

export type Meta = Map<string, string[]>

export async function postsOf(wp: SQL, blogId: number, type: string): Promise<WpPost[]> {
  return await wp.unsafe(
    `SELECT ID, post_author, post_content, post_title, post_status, post_name, post_type, post_parent,
       IF(post_date_gmt > '1971-01-01', post_date_gmt, IF(post_date > '1971-01-01', post_date, UTC_TIMESTAMP())) post_date_gmt,
       IF(post_modified_gmt > '1971-01-01', post_modified_gmt, IF(post_modified > '1971-01-01', post_modified, UTC_TIMESTAMP())) post_modified_gmt
     FROM ${table(blogId, 'posts')} WHERE post_type = ? AND post_status NOT IN ('trash', 'auto-draft') ORDER BY ID`,
    [type]
  ) as WpPost[]
}

// Every meta value of the given posts, keyed by post id then meta key.
export async function metaOf(wp: SQL, blogId: number, postIds: number[]): Promise<Map<number, Meta>> {
  const out = new Map<number, Meta>()
  for (let i = 0; i < postIds.length; i += 5000) {
    const ids = postIds.slice(i, i + 5000)
    if (!ids.length) continue
    const rows = await wp.unsafe(
      `SELECT post_id, meta_key, meta_value FROM ${table(blogId, 'postmeta')} WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY meta_id`,
      ids
    ) as { post_id: number, meta_key: string, meta_value: string | null }[]
    for (const r of rows) {
      let m = out.get(Number(r.post_id))
      if (!m) out.set(Number(r.post_id), m = new Map())
      const list = m.get(r.meta_key) ?? []
      list.push(r.meta_value ?? '')
      m.set(r.meta_key, list)
    }
  }
  return out
}

export function first(meta: Meta | undefined, key: string): string | null {
  const v = meta?.get(key)?.[0]
  return v === undefined || v === '' ? null : v
}

export async function options(wp: SQL, blogId: number, names: string[]): Promise<Map<string, string>> {
  if (!names.length) return new Map()
  const rows = await wp.unsafe(
    `SELECT option_name, option_value FROM ${table(blogId, 'options')} WHERE option_name IN (${names.map(() => '?').join(',')})`,
    names
  ) as { option_name: string, option_value: string }[]
  return new Map(rows.map(r => [r.option_name, r.option_value]))
}

// PHP's unserialize() for the scalar, array and stdClass values WordPress
// stores. Strings are byte-counted, so the input is walked as UTF-8 bytes.
export function unserialize(input: string | null | undefined): unknown {
  if (input === null || input === undefined) return null
  if (!/^(a|s|i|d|b|N|O):/.test(input)) return input
  const bytes = Buffer.from(input, 'utf8')
  let pos = 0
  const readUntil = (ch: string) => {
    const end = bytes.indexOf(ch.charCodeAt(0), pos)
    if (end < 0) throw new Error('unserialize: unexpected end')
    const s = bytes.toString('utf8', pos, end)
    pos = end + 1
    return s
  }
  const value = (): unknown => {
    const type = String.fromCharCode(bytes[pos]!)
    pos += 2
    switch (type) {
      case 'N': return null
      case 'b': return readUntil(';') === '1'
      case 'i': return Number(readUntil(';'))
      case 'd': return Number(readUntil(';'))
      case 's': {
        const len = Number(readUntil(':'))
        const s = bytes.toString('utf8', pos + 1, pos + 1 + len)
        pos += len + 3
        return s
      }
      case 'a': {
        const n = Number(readUntil(':'))
        pos += 1
        const entries: [string | number, unknown][] = []
        for (let k = 0; k < n; k++) entries.push([value() as string | number, value()])
        pos += 1
        const isList = entries.every(([k], idx) => k === idx)
        return isList ? entries.map(([, v]) => v) : Object.fromEntries(entries)
      }
      case 'O': {
        readUntil(':')
        readUntil(':')
        const n = Number(readUntil(':'))
        pos += 1
        const obj: Record<string, unknown> = {}
        for (let k = 0; k < n; k++) {
          const key = value() as string
          obj[key] = value()
        }
        pos += 1
        return obj
      }
      default: throw new Error(`unserialize: unknown type ${type}`)
    }
  }
  try {
    return value()
  } catch {
    return input
  }
}

// WordPress locale → v3 language code.
const LOCALE_TO_LANGUAGE: Record<string, string> = {
  en_US: 'en', en_GB: 'en', en_AU: 'en', en_CA: 'en',
  es_ES: 'es', es_419: 'es', es_MX: 'es', fr_FR: 'fr', fr_CA: 'fr', pt_BR: 'pt', pt_PT: 'pt', de_DE: 'de', it_IT: 'it', nl_NL: 'nl',
  ar: 'ar', ar_EG: 'ar', fa_IR: 'fa', ur: 'ur', hi_IN: 'hi', bn_BD: 'bn', ne_NP: 'ne', id_ID: 'id', ru_RU: 'ru', tr_TR: 'tr',
  zh_CN: 'zh-hans', zh_Hans: 'zh-hans', zh_TW: 'zh-hant', zh_Hant: 'zh-hant', ko_KR: 'ko', ja: 'ja', sw: 'sw', am: 'am', mn: 'mn',
  ro_RO: 'ro', pl_PL: 'pl', uk: 'uk', hu_HU: 'hu', sr_BA: 'sr', bs_BA: 'bs', hr: 'hr', sl_SI: 'sl', th: 'th', vi: 'vi', my_MM: 'my',
  tl: 'tl', ms_MY: 'ms', ha: 'ha', so: 'so', ku: 'ku', ps: 'ps', ta_IN: 'ta', te: 'te', ml_IN: 'ml', mr: 'mr', gu: 'gu', pa_IN: 'pa',
  he_IL: 'he', el: 'el', nb_NO: 'nb', sv_SE: 'sv', da_DK: 'da', fi: 'fi', cs_CZ: 'cs', sk_SK: 'sk', bg_BG: 'bg', mk_MK: 'mk'
}

export function languageOf(locale: string | null | undefined): string {
  if (!locale) return 'en'
  return LOCALE_TO_LANGUAGE[locale] ?? locale.split('_')[0]!.toLowerCase()
}
