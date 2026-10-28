import { sql } from 'kysely'
import { db } from '#core/server/utils/database'
import { slugError, slugify } from '@prayertools/shared/config'
import { containsBlockedWord } from '@prayertools/shared/moderation'
import { isLanguage, LANGUAGES } from '@prayertools/shared/languages'
import { isValidTimezone } from '@prayertools/shared/dates'
import { ensureSystemUser, upsertContact } from '@prayertools/shared/crm'
import { withOrg } from '@prayertools/shared/db/scope'
import { jsonb, pgArray } from '@prayertools/shared/db/json'
import { forwardEvent } from '@prayertools/shared/statinator'
import { enableSiteApps } from '@prayertools/shared/site'
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
  const user = await db.selectFrom('users').select(['email', 'display_name']).where('id', '=', userId).executeTakeFirst()
  if (!user) return
  const staffOrgId = await ptStaffOrgId()
  await withOrg(db as never, staffOrgId, async (tx) => {
    const { contactId } = await upsertContact(tx, { email: user.email, name: user.display_name, data: { pt_role: 'champion' }, source: 'site creation', actorLabel: 'prayer.tools' })
    await tx.insertInto('crm_record_field_entries' as never).values({ record_id: contactId, field_key: 'tags', payload: jsonb({ value: 'champion' }), normalized_value: 'champion' } as never)
      .onConflict(oc => oc.doNothing()).execute()
  })
}

export const PT_LANGUAGE_OPTIONS = LANGUAGES.map(l => ({ value: l.code, label: `${l.name} — ${l.native}` }))
