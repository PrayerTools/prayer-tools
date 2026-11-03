import { sql, type Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import type { TenantContext } from '#tenant/server'
import { db } from '#core/server/utils/database'
import { slugError, slugify } from '@prayertools/shared/config'
import { containsBlockedWord } from '@prayertools/shared/moderation'
import { isLanguage, LANGUAGES } from '@prayertools/shared/languages'
import { isValidTimezone } from '@prayertools/shared/dates'
import { ensureSystemUser, upsertContact } from '@prayertools/shared/crm'
import { accountById, linkContactToAccount } from '@prayertools/shared/accounts'
import { withOrg } from '@prayertools/shared/db/scope'
import { jsonb, pgArray } from '@prayertools/shared/db/json'
import { forwardEvent } from '@prayertools/shared/statinator'
import { enableSiteApps, settingsOverrides, subdomainUrl } from '@prayertools/shared/site'
import { hashToken, randomToken } from '@prayertools/shared/tokens'
import { randomBrandColor } from '@prayertools/shared/colors'

export const PT_STAFF_SLUG = 'staff'

export interface CreateSiteInput {
  name: string
  slug: string
  languages?: string[]
  default_language?: string
  timezone?: string
}

export function ptValidateSiteInput(input: CreateSiteInput): Record<string, string> {
  const errors: Record<string, string> = {}
  const name = (input.name ?? '').trim()
  if (name.length < 2 || name.length > 80) errors.name = 'Name must be 2–80 characters.'
  else if (containsBlockedWord(name)) errors.name = 'Please choose another name.'
  const slugErr = slugError(input.slug ?? '')
  if (slugErr === 'reserved') errors.slug = 'This address is reserved.'
  else if (slugErr) errors.slug = 'Use 3–40 lowercase letters, digits and single hyphens.'
  else if (containsBlockedWord(input.slug)) errors.slug = 'Please choose another address.'
  const langs = input.languages ?? ['en']
  if (!langs.length || langs.some(l => !isLanguage(l))) errors.languages = 'Choose at least one language.'
  if (input.default_language && !langs.includes(input.default_language)) errors.default_language = 'The default language must be one of the site languages.'
  if (input.timezone && !isValidTimezone(input.timezone)) errors.timezone = 'Unknown timezone.'
  return errors
}

export async function ptSlugTaken(slug: string): Promise<boolean> {
  const row = await db.selectFrom('orgs').select('id').where('slug', '=', slug).executeTakeFirst()
  return !!row
}

// An unused address for a new site: the name's slug, numbered when taken, or a
// random one when the name gives no usable slug.
export async function ptFreeSlug(name: string): Promise<string> {
  const base = slugify(name)
  if (!slugError(base) && !containsBlockedWord(base)) {
    if (!(await ptSlugTaken(base))) return base
    const stem = base.slice(0, 36).replace(/-+$/, '')
    for (let i = 2; i < 50; i++) {
      if (!(await ptSlugTaken(`${stem}-${i}`))) return `${stem}-${i}`
    }
  }
  return `site-${crypto.randomUUID().slice(0, 8)}`
}

// Creates the org (the site), the owner's membership, the site's apps, and the
// pt_site row — one transaction.
export async function ptCreateSite(userId: string, input: CreateSiteInput): Promise<{ id: string, slug: string, name: string }> {
  await ensureSystemUser(db as never)
  const orgId = crypto.randomUUID()
  const membershipId = crypto.randomUUID()
  const now = new Date().toISOString()
  const languages = input.languages?.length ? input.languages : ['en']
  try {
    await db.transaction().execute(async (tx) => {
      await tx.insertInto('orgs').values({ id: orgId, slug: input.slug, name: input.name.trim(), created_at: now, updated_at: now }).execute()
      await tx.insertInto('memberships').values({ id: membershipId, user_id: userId, org_id: orgId, roles: ['admin'], created_at: now, updated_at: now }).execute()
      await enableSiteApps(tx as never, orgId)
      await sql`select set_config('app.current_org', ${orgId}, true)`.execute(tx)
      await tx.insertInto('pt_site').values({
        org_id: orgId,
        languages: pgArray(languages),
        default_language: input.default_language ?? languages[0]!,
        timezone: input.timezone ?? 'UTC',
        branding: jsonb({ color: randomBrandColor() }),
        onboarding: jsonb({ step: 'setup' })
      } as never).execute()
    })
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'That address is already taken.' })
    throw err
  }

  const nitro = useNitroApp()
  const hook = async (name: string, payload: unknown) => {
    try {
      await (nitro.hooks.callHook as (n: string, p: unknown) => Promise<void>)(name, payload)
    } catch (err) {
      console.warn(`[hook ${name}]`, err)
    }
  }
  await hook('org.created', { orgId, slug: input.slug, createdByUserId: userId })
  await hook('membership.created', { membershipId, userId, orgId, roles: ['admin'], createdByUserId: userId })
  const seeded = await db.selectFrom('org_apps').select('app_id').where('org_id', '=', orgId).execute()
  for (const a of seeded) await hook('app.enabled', { orgId, appId: a.app_id })

  ptAddChampionToStaffCrm(userId).catch(err => console.warn('[pt] staff CRM', err))
  forwardEvent({ event_type: 'campaign_created', hostname: null, metadata: { site_id: orgId, site_slug: input.slug } }).catch(() => {})
  return { id: orgId, slug: input.slug, name: input.name.trim() }
}

export async function ptStaffOrgId(): Promise<string> {
  const existing = await db.selectFrom('orgs').select('id').where('slug', '=', PT_STAFF_SLUG).executeTakeFirst()
  if (existing) return existing.id
  const now = new Date().toISOString()
  await db.insertInto('orgs').values({ id: crypto.randomUUID(), slug: PT_STAFF_SLUG, name: 'Prayer.Tools', created_at: now, updated_at: now })
    .onConflict(oc => oc.column('slug').doNothing()).execute()
  const row = await db.selectFrom('orgs').select('id').where('slug', '=', PT_STAFF_SLUG).executeTakeFirstOrThrow()
  await enableSiteApps(db as never, row.id)
  return row.id
}

// Champions are contacts in the staff org's CRM, tagged for platform mailings.
export async function ptAddChampionToStaffCrm(userId: string): Promise<void> {
  const account = await accountById(db as never, userId)
  if (!account?.email) return
  const email = account.email
  const staffOrgId = await ptStaffOrgId()
  await withOrg(db as never, staffOrgId, async (tx) => {
    const { contactId } = await upsertContact(tx, { email, name: account.display_name, data: { pt_role: 'champion' }, source: 'site creation', actorLabel: 'prayer.tools' })
    await linkContactToAccount(tx, contactId, account)
    await tx.insertInto('crm_record_field_entries' as never).values({ record_id: contactId, field_key: 'tags', payload: jsonb({ value: 'champion' }), normalized_value: 'champion' } as never)
      .onConflict(oc => oc.doNothing()).execute()
  })
}

export const PT_LANGUAGE_OPTIONS = LANGUAGES.map(l => ({ value: l.code, label: `${l.name} — ${l.native}` }))

// Applies the fields present in `b` to the site. The sending identity also
// needs pt.site.manage.
export async function ptUpdateSite(tx: Transaction<Database>, ctx: TenantContext, b: Record<string, unknown>) {
  const site = await ptSite(tx)
  const patch: Record<string, unknown> = {}

  if (typeof b.name === 'string') {
    const name = b.name.trim()
    if (name.length < 2 || name.length > 80) ptBadRequest('Name must be 2–80 characters.')
    if (containsBlockedWord(name)) ptBadRequest('Please choose another name.')
    await tx.updateTable('orgs').set({ name, updated_at: new Date().toISOString() }).where('id', '=', ctx.orgId).execute()
  }
  if ('timezone' in b) {
    if (!isValidTimezone(b.timezone)) ptBadRequest('Unknown timezone.')
    patch.timezone = b.timezone
  }
  if ('languages' in b || 'default_language' in b) {
    const languages = Array.isArray(b.languages) ? [...new Set(b.languages as string[])] : site.languages
    const def = typeof b.default_language === 'string' ? b.default_language : site.default_language
    if (!languages.length || languages.some(l => !isLanguage(l))) ptBadRequest('Choose at least one language.')
    if (!languages.includes(def)) ptBadRequest('The default language must be one of the site languages.')
    patch.languages = pgArray(languages)
    patch.default_language = def
  }
  if ('branding' in b) patch.branding = jsonb(ptBranding(b.branding))
  if ('email_identity' in b) {
    ptNeed(ctx, 'pt.site.manage')
    patch.email_identity = jsonb(ptIdentity(b.email_identity))
  }
  if ('settings' in b && b.settings && typeof b.settings === 'object') {
    patch.settings = jsonb(settingsOverrides({ ...(site.settings as Record<string, unknown>), ...(b.settings as Record<string, unknown>) }))
  }
  if ('onboarding' in b && b.onboarding && typeof b.onboarding === 'object') {
    const o = b.onboarding as Record<string, unknown>
    patch.onboarding = jsonb({ step: typeof o.step === 'string' ? o.step.slice(0, 40) : undefined, completed: o.completed === true })
  }
  if (Object.keys(patch).length) {
    await tx.updateTable('pt_site').set({ ...patch, updated_at: new Date() } as never).where('org_id', '=', ctx.orgId).execute()
  }
  return { ok: true }
}

// A new preview link for the site; only its hash is stored, so the previous
// link stops working.
export async function ptNewPreviewLink(tx: Transaction<Database>, ctx: Pick<TenantContext, 'orgId' | 'orgSlug'>): Promise<string> {
  const token = randomToken(24)
  await tx.updateTable('pt_site').set({ preview_token_hash: hashToken(token) }).where('org_id', '=', ctx.orgId).execute()
  return `${subdomainUrl(ctx.orgSlug)}/preview/${token}`
}
