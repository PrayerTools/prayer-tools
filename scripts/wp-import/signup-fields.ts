// A site's own signup questions (subscription fields WordPress showed on the
// signup form) → v3 signup fields with their CRM field `pt_<key>`, and each
// subscriber's answer → their contact's `pt_<key>`, as v3's signup stores it.
import type { SQL } from 'bun'
import type { Tx } from '@prayertools/shared/db/scope'
import type { TranslatableText } from '@prayertools/shared/db/schema'
import { jsonb } from '@prayertools/shared/db/json'
import { SYSTEM_USER_ID } from '@prayertools/shared/crm'
import { languageOf, options, unserialize } from './wp'

export interface ImportedField {
  wpKey: string
  key: string
  kind: 'text' | 'select' | 'checkbox'
  optionKeys: string[]
}

const KINDS = { text: 'text', key_select: 'select', boolean: 'checkbox' } as const
const CRM_KINDS = { text: 'text', select: 'key_select', checkbox: 'boolean' } as const
// v3 asks at most five questions at signup.
const MAX_FIELDS = 5

interface WpField {
  name?: string
  type?: string
  tile?: string
  required?: boolean
  translations?: Record<string, string>
  default?: Record<string, { label?: string, translations?: Record<string, string> }>
}

function text(label: string, translations: Record<string, string> | undefined, defaultLanguage: string, languages: string[]): TranslatableText {
  const values: Record<string, string> = { [defaultLanguage]: label }
  for (const [locale, v] of Object.entries(translations ?? {})) {
    const lang = languageOf(locale)
    if (languages.includes(lang) && v?.trim() && lang !== defaultLanguage) values[lang] = v.trim()
  }
  return { source: defaultLanguage, values, stale: [] }
}

export async function importSignupFields(wp: SQL, blogId: number, tx: Tx, input: { defaultLanguage: string, languages: string[] }): Promise<{ fields: ImportedField[], skipped: string[] }> {
  const raw = unserialize((await options(wp, blogId, ['dt_field_customizations'])).get('dt_field_customizations')) as { subscriptions?: Record<string, WpField> } | null
  const wpFields = Object.entries(raw?.subscriptions ?? {}).filter(([, f]) => f?.tile === 'signup_form')
  const fields: ImportedField[] = []
  const skipped: string[] = []
  for (const [wpKey, f] of wpFields) {
    const kind = KINDS[f.type as keyof typeof KINDS]
    const label = f.name?.trim()
    const opts = Object.entries(f.default ?? {}).filter(([, o]) => o?.label?.trim())
    if (!kind || !label || (kind === 'select' && opts.length < 2) || fields.length >= MAX_FIELDS) { skipped.push(wpKey); continue }
    const key = wpKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
    const optionList = kind === 'select'
      ? opts.map(([k, o]) => ({ key: k, label: text(o.label!.trim(), o.translations, input.defaultLanguage, input.languages) }))
      : []
    await tx.insertInto('pt_signup_field').values({
      key, kind, label: jsonb(text(label, f.translations, input.defaultLanguage, input.languages)),
      options: jsonb(optionList), required: !!f.required, position: fields.length
    }).execute()
    await tx.insertInto('records_fields' as never).values({
      type_key: 'contacts',
      field_key: `pt_${key}`.slice(0, 41),
      kind: CRM_KINDS[kind],
      label_override: label,
      order_override: 1000 + fields.length,
      config: jsonb(kind === 'select'
        ? { options: Object.fromEntries(optionList.map(o => [o.key, { label: o.label.values[input.defaultLanguage] }])), ...(optionList.length > 1 ? { optionOrder: optionList.map(o => o.key) } : {}) }
        : {}),
      updated_by: SYSTEM_USER_ID
    } as never).execute()
    fields.push({ wpKey, key, kind, optionKeys: optionList.map(o => o.key) })
  }
  return { fields, skipped }
}

// A subscriber's answers, keyed as v3's signup stores them on the contact.
export function answersOf(fields: ImportedField[], value: (wpKey: string) => string | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = value(f.wpKey)
    if (v === undefined) continue
    if (f.kind === 'text' && v.trim()) out[`pt_${f.key}`] = v.trim().slice(0, 500)
    if (f.kind === 'select' && f.optionKeys.includes(v)) out[`pt_${f.key}`] = v
    if (f.kind === 'checkbox') out[`pt_${f.key}`] = v === '1' || v === 'true'
  }
  return out
}
