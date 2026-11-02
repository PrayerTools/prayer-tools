// Signup questions and the site's own consent options, shared by the admin
// routes and the MCP tools.
import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import type { TenantContext } from '#tenant/server'
import { createField } from '#crm/server'
import { parseText, textIn } from '@prayertools/shared/translatable'
import { jsonb } from '@prayertools/shared/db/json'

const CRM_KIND = { text: 'text', select: 'key_select', checkbox: 'boolean' } as const

// Adds a signup question and its CRM field `pt_<key>`.
export async function ptCreateSignupField(tx: Transaction<Database>, ctx: TenantContext, b: Record<string, unknown>) {
  const site = await ptSite(tx)
  const count = await tx.selectFrom('pt_signup_field').select(eb => eb.fn.countAll<string>().as('n')).executeTakeFirst()
  if (Number(count?.n ?? 0) >= 5) ptBadRequest('A site can ask up to five questions at signup.')
  const kind = b.kind as keyof typeof CRM_KIND
  if (!(kind in CRM_KIND)) ptBadRequest('Choose short text, dropdown or checkbox.')
  const label = parseText(b.label)
  if (!label || !textIn(label, site.default_language).trim()) ptBadRequest('Give the question a label.')
  const options = kind === 'select' ? ptFieldOptions(b.options) : []
  if (kind === 'select' && options.length < 2) ptBadRequest('A dropdown needs at least two options.')
  const key = String(b.key ?? textIn(label, site.default_language)).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || `q${Date.now() % 100000}`
  const exists = await tx.selectFrom('pt_signup_field').select('id').where('key', '=', key).executeTakeFirst()
  if (exists) ptBadRequest('A question with this key already exists.')
  await createField(tx, ctx, 'contacts', {
    fieldKey: `pt_${key}`.slice(0, 41),
    kind: CRM_KIND[kind],
    label: textIn(label, site.default_language),
    ...(kind === 'select' ? { options: Object.fromEntries(options.map(o => [o.key, { label: textIn(o.label, site.default_language) }])) } : {})
  } as never).catch((err: { statusMessage?: string }) => ptBadRequest(err.statusMessage ?? 'Could not add the field to the CRM.'))
  const max = await tx.selectFrom('pt_signup_field').select(eb => eb.fn.max('position').as('max')).executeTakeFirst()
  const row = await tx.insertInto('pt_signup_field').values({
    key, kind, label: jsonb(label), options: jsonb(options), required: b.required === true, position: Number(max?.max ?? -1) + 1
  } as never).returningAll().executeTakeFirstOrThrow()
  return { field: row }
}

// Edits a signup question. Labels and options need pt.content.translate; the
// required flag and position need pt.site.write.
export async function ptUpdateSignupField(tx: Transaction<Database>, ctx: TenantContext, id: string, b: Record<string, unknown>) {
  const field = await tx.selectFrom('pt_signup_field').selectAll().where('id', '=', id).executeTakeFirst()
  if (!field) ptNotFound('Question not found.')
  const patch: Record<string, unknown> = {}
  if ('label' in b) {
    const label = parseText(b.label)
    if (!label) ptBadRequest('Invalid label.')
    patch.label = jsonb(label)
  }
  if ('options' in b && field.kind === 'select') patch.options = jsonb(ptFieldOptions(b.options))
  const structural = 'required' in b || 'position' in b
  if (structural) {
    ptNeed(ctx, 'pt.site.write')
    if ('required' in b) patch.required = b.required === true
    if (Number.isInteger(b.position)) patch.position = b.position
  }
  if (Object.keys(patch).length) await tx.updateTable('pt_signup_field').set(patch as never).where('id', '=', id).execute()
  return { ok: true }
}

// Adds one of the site's own consent options, offered unchecked at signup.
export async function ptCreateConsentOption(tx: Transaction<Database>, b: Record<string, unknown>) {
  const site = await ptSite(tx)
  const label = parseText(b.label)
  if (!label || !textIn(label, site.default_language).trim()) ptBadRequest('Write the wording people will see.')
  const count = await tx.selectFrom('pt_consent_option').select(eb => eb.fn.countAll<string>().as('n')).executeTakeFirst()
  if (Number(count?.n ?? 0) >= 5) ptBadRequest('A site can add up to five consent options.')
  const key = textIn(label, site.default_language).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || `option_${Date.now() % 100000}`
  const exists = await tx.selectFrom('pt_consent_option').select('id').where('key', '=', key).executeTakeFirst()
  const max = await tx.selectFrom('pt_consent_option').select(eb => eb.fn.max('position').as('max')).executeTakeFirst()
  const row = await tx.insertInto('pt_consent_option').values({
    key: exists ? `${key}_${Date.now() % 1000}` : key, label: jsonb(label), position: Number(max?.max ?? -1) + 1
  } as never).returningAll().executeTakeFirstOrThrow()
  return { option: row }
}

// Edits a consent option's wording (pt.content.translate) or turns it on or
// off (pt.site.write).
export async function ptUpdateConsentOption(tx: Transaction<Database>, ctx: TenantContext, id: string, b: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  if ('label' in b) {
    const label = parseText(b.label)
    if (!label) ptBadRequest('Invalid wording.')
    patch.label = jsonb(label)
  }
  if ('active' in b) {
    ptNeed(ctx, 'pt.site.write')
    patch.active = b.active === true
  }
  if (Object.keys(patch).length) await tx.updateTable('pt_consent_option').set(patch as never).where('id', '=', id).execute()
  return { ok: true }
}
