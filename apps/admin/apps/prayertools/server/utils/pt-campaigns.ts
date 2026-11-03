import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import type { TenantContext } from '#tenant/server'
import { applyTemplate, campaignStatus, DEFAULT_SLOT_MIN, displayLength, isSideCampaign, overlappingCampaign, pickCurrentCampaign, SLOT_OPTIONS, suggestCampaignSlug, suggestSideSlug, TEMPLATES, validateSetup, withPersonalSetup, type CampaignTemplate, type SetupAnswers } from '@prayertools/shared/setup'
import type { CampaignBranding, CampaignKind } from '@prayertools/shared/db/schema'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import { addTemplateLibraries, readPersonalTemplate, type PersonalTemplate } from '@prayertools/shared/personal-templates'
import { runAsShareUser } from '#core/server/utils/shares'
import { campaignSlugError } from '@prayertools/shared/paths'
import { isValidTimezone } from '@prayertools/shared/dates'
import { parseText } from '@prayertools/shared/translatable'
import { parsePlaceWording } from '@prayertools/shared/place'
import { jsonb } from '@prayertools/shared/db/json'
import { campaignById, campaignEditMissing, campaignSeries, loadCampaigns, normalizeCampaign } from '@prayertools/shared/campaigns'
import { goalProgress } from '@prayertools/shared/stats'
import { campaignEntries, campaignLibraries, contentLength } from '@prayertools/shared/content'
import { isTemplateWhy } from '@prayertools/shared/i18n/landing'

export function ptSetupFromBody(b: Record<string, unknown>, templateKey: string | CampaignTemplate, base?: Partial<SetupAnswers>, kind: CampaignKind | null = null): SetupAnswers {
  const chosen: Partial<SetupAnswers> = { ...base }
  for (const k of ['start_mode', 'start_date', 'end_mode', 'end_date', 'length_days', 'goal', 'cadence', 'track_time'] as const) {
    if (k in b) (chosen as Record<string, unknown>)[k] = b[k]
  }
  const answers = applyTemplate(templateKey, chosen)
  const errors = validateSetup(answers, kind)
  if (errors.length) ptBadRequest(kind === 'side' ? 'A side campaign needs a start date and an end date.' : 'Please check the campaign setup.', { errors })
  return answers
}

export async function ptAssertNoOverlap(tx: Transaction<Database>, answers: SetupAnswers & { timezone: string }, kind: CampaignKind | null, exceptId?: string) {
  if (kind === 'side') return
  const others = (await loadCampaigns(ptTx(tx), { drafts: true })).filter(c => !c.ended_at && c.id !== exceptId)
  const clash = overlappingCampaign(answers, kind, others)
  if (clash) ptBadRequest(`These dates overlap "${clash.name}". A site runs one main campaign at a time; a side campaign can run alongside it.`)
}

export function ptCampaignKind(input: unknown): CampaignKind | null {
  return input === 'side' ? 'side' : null
}

export function ptCampaignExtras(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  if (typeof b.name === 'string') {
    const name = b.name.trim()
    if (name.length < 2 || name.length > 120) ptBadRequest('Campaign name must be 2–120 characters.')
    out.name = name
  }
  if (typeof b.slug === 'string' && b.slug) {
    if (campaignSlugError(b.slug)) ptBadRequest('The campaign address may use lowercase letters, digits and hyphens, and cannot be a page name or language code.')
    out.slug = b.slug
  }
  if ('timezone' in b && b.timezone) {
    if (!isValidTimezone(b.timezone)) ptBadRequest('Unknown timezone.')
    out.timezone = b.timezone
  }
  for (const k of ['place_name', 'people_group'] as const) {
    if (k in b) out[k] = typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string).trim().slice(0, 200) : null
  }
  if ('place_wording' in b) out.place_wording = jsonb(parsePlaceWording(b.place_wording))
  for (const k of ['latitude', 'longitude'] as const) {
    if (k in b) {
      const v = b[k]
      if (v !== null && (typeof v !== 'number' || Math.abs(v) > (k === 'latitude' ? 90 : 180))) ptBadRequest(`Invalid ${k}.`)
      out[k] = v
    }
  }
  if ('goal_target' in b) {
    const v = b.goal_target
    if (v !== null && !(Number.isInteger(v) && (v as number) > 0 && (v as number) < 10_000_000)) ptBadRequest('Goal target must be a positive whole number.')
    out.goal_target = v
  }
  if ('slot_min' in b) {
    const v = b.slot_min
    if (v !== null && !SLOT_OPTIONS.includes(v as number)) ptBadRequest('Choose a slot length from the list.')
    out.slot_min = v === DEFAULT_SLOT_MIN ? null : v
  }
  return out
}

export function ptCta(input: unknown) {
  const c = (input ?? {}) as Record<string, unknown>
  if (c.mode === 'none') return { mode: 'none' as const }
  const url = typeof c.url === 'string' && /^https?:\/\//.test(c.url) ? c.url.slice(0, 2000) : undefined
  const label = parseText(c.label) ?? undefined
  return url && label ? { url, label } : {}
}

// Creates a campaign from setup answers, relaunches `relaunchOf` with its
// answers, libraries and look, or starts from `personal_template_id`.
export async function ptCreateCampaign(tx: Transaction<Database>, ctx: TenantContext, b: Record<string, unknown>) {
  const site = await ptSite(tx)
  let base: Record<string, unknown> | undefined
  let templateKey = typeof b.template_key === 'string' ? b.template_key : 'generic'
  let previous: CampaignRow | null = null
  if (typeof b.relaunchOf === 'string') {
    previous = await campaignById(ptTx(tx), b.relaunchOf, { drafts: true })
    if (!previous) ptNotFound('Campaign not found.')
    templateKey = previous.template_key ?? 'generic'
    base = { start_mode: previous.start_mode, end_mode: previous.end_mode, length_days: previous.length_days, goal: previous.goal, cadence: previous.cadence, track_time: previous.track_time }
    if (previous.start_mode === 'date' && previous.start_date && previous.end_date && !('end_date' in b) && typeof b.start_date === 'string') {
      const days = (Date.parse(previous.end_date) - Date.parse(previous.start_date)) / 86_400_000
      b.end_date = new Date(Date.parse(b.start_date) + days * 86_400_000).toISOString().slice(0, 10)
    }
  }
  let personal: PersonalTemplate | null = null
  if (!previous && typeof b.personal_template_id === 'string') {
    const id = b.personal_template_id
    personal = await runAsShareUser(ctx.userId, utx => readPersonalTemplate(ptTx(utx), id))
    if (!personal) ptNotFound('Template not found.')
    templateKey = personal.template_key ?? 'generic'
  }
  const kind = previous ? previous.kind : ptCampaignKind(b.kind)
  const answers = ptSetupFromBody(b, personal ? withPersonalSetup(templateKey, personal.setup) : templateKey, base as never, kind)
  const extras = ptCampaignExtras(b)
  const timezone = (extras.timezone as string) ?? site.timezone
  await ptAssertNoOverlap(tx, { ...answers, timezone }, kind)
  const name = (extras.name as string) ?? previous?.name ?? ctx.orgName
  const taken = (await tx.selectFrom('pt_campaign').select('slug').execute()).map(r => r.slug)
  const slug = (extras.slug as string) ?? (kind === 'side' ? suggestSideSlug(name, answers.start_date, taken) : suggestCampaignSlug(answers.start_date, taken))
  if (taken.includes(slug)) ptBadRequest('That campaign address is already used on this site.')
  const hasMain = !!(await tx.selectFrom('pt_campaign').select('id').where('kind', 'is', null).executeTakeFirst())
  const mains = previous ? [] : (await loadCampaigns(ptTx(tx), { drafts: true })).filter(c => !isSideCampaign(c))
  const look = previous ?? pickCurrentCampaign(mains)?.campaign ?? mains.at(-1)
  const carried = previous ?? personal
  const created = await tx.insertInto('pt_campaign').values({
    slug,
    name,
    template_key: templateKey,
    kind,
    ...answers,
    timezone,
    place_name: 'place_name' in extras ? extras.place_name : (look?.place_name ?? null),
    place_wording: 'place_wording' in extras ? extras.place_wording : jsonb(look?.place_wording ?? {}),
    people_group: 'people_group' in extras ? extras.people_group : (look?.people_group ?? null),
    latitude: 'latitude' in extras ? extras.latitude : (look?.latitude ?? null),
    longitude: 'longitude' in extras ? extras.longitude : (look?.longitude ?? null),
    goal_target: (extras.goal_target as number | null | undefined) ?? previous?.goal_target ?? personal?.setup.goal_target ?? null,
    slot_min: 'slot_min' in extras ? extras.slot_min as number | null : (previous?.slot_min ?? personal?.setup.slot_min ?? null),
    end_message: b.end_message ? jsonb(parseText(b.end_message)) : (carried?.end_message ? jsonb(carried.end_message) : null),
    cta: jsonb(b.cta ? ptCta(b.cta) : (carried?.cta ?? {})),
    landing: jsonb(personal ? personal.landing : look && (previous || kind !== 'side') ? look.landing : {}),
    branding: jsonb(personal ? { ...look?.branding, ...personal.branding } : (look?.branding ?? {})),
    share: jsonb(look?.share ?? {}),
    description: personal ? (personal.description ? jsonb(personal.description) : null) : look?.description && (previous || kind !== 'side') ? jsonb(look.description) : null,
    relaunch_of: previous?.id ?? null,
    // A campaign starts as a draft, except a site's first main campaign while
    // the site is being set up: it goes live with the site, whose checklist covers it.
    published_at: site.status === 'draft' && kind !== 'side' && !hasMain ? new Date() : null
  } as never).returningAll().executeTakeFirstOrThrow()
  if (previous) {
    const libs = await tx.selectFrom('pt_campaign_library').select(['site_library_id', 'position']).where('campaign_id', '=', previous.id).execute()
    if (libs.length) await tx.insertInto('pt_campaign_library').values(libs.map(l => ({ campaign_id: created.id, site_library_id: l.site_library_id, position: l.position }))).execute()
  }
  if (personal) await addTemplateLibraries(ptTx(tx), created.id, personal.library_ids, ctx.userId)
  return { campaign: normalizeCampaign(created) }
}

// One campaign with its status, length, entries, commitments, goal progress
// and stacked libraries.
export async function ptCampaignDetail(tx: Transaction<Database>, id: string) {
  const site = await ptSite(tx)
  const c = await campaignById(ptTx(tx), id, { drafts: true })
  if (!c) ptNotFound('Campaign not found.')
  const commitments = await tx.selectFrom('pt_commitment').select(eb => eb.fn.countAll<string>().as('n')).where('campaign_id', '=', c.id).executeTakeFirst()
  return {
    campaign: {
      ...c,
      status: campaignStatus(c),
      length: displayLength(c),
      entries: await campaignEntries(ptTx(tx), c),
      commitments: Number(commitments?.n ?? 0),
      contentEntries: await contentLength(ptTx(tx), c.id),
      progress: await goalProgress(ptTx(tx), c, site.settings_merged.default_duration_min),
      // The place wording matters only when the campaign's content names the place.
      usesPlaceWording: await ptCampaignUsesPlacePhrases(tx, c.id, { name: true }),
      // Every run of the campaign, this one included.
      series: (await campaignSeries(ptTx(tx), c.id, { drafts: true })).map(r => r.id)
    },
    libraries: await campaignLibraries(ptTx(tx), c.id)
  }
}

// Applies the fields present in `b` to a campaign, after checking `ctx` holds
// the permissions those fields need (campaignEditMissing).
export async function ptUpdateCampaign(tx: Transaction<Database>, ctx: TenantContext, id: string, b: Record<string, unknown>) {
  const missing = campaignEditMissing(Object.keys(b), ctx.perms)
  if (missing) ptNeed(ctx, missing)
  const c = await campaignById(ptTx(tx), id, { drafts: true })
  if (!c) ptNotFound('Campaign not found.')
  const patch: Record<string, unknown> = ptCampaignExtras(b)
  if (typeof b.template_key === 'string') {
    if (!TEMPLATES.some(t => t.key === b.template_key)) ptBadRequest('Unknown template.')
    patch.template_key = b.template_key
  }
  const templateKey = (patch.template_key as string | undefined) ?? c.template_key
  const setupKeys = ['start_mode', 'start_date', 'end_mode', 'end_date', 'length_days', 'goal', 'cadence', 'track_time']
  if (setupKeys.some(k => k in b)) {
    const answers = ptSetupFromBody(b, 'generic', { start_mode: c.start_mode, start_date: c.start_date, end_mode: c.end_mode, end_date: c.end_date, length_days: c.length_days, goal: c.goal, cadence: c.cadence, track_time: c.track_time }, c.kind)
    await ptAssertNoOverlap(tx, { ...answers, timezone: (patch.timezone as string) ?? c.timezone }, c.kind, id)
    if ('length_days' in b && answers.length_days) {
      const entries = await contentLength(ptTx(tx), id)
      if (entries && answers.length_days > entries) ptBadRequest(`The prayer content has ${entries} entries, so each person can go through at most ${entries}.`)
    }
    Object.assign(patch, answers)
  }
  if (patch.slug && patch.slug !== c.slug) {
    const taken = await tx.selectFrom('pt_campaign').select('id').where('slug', '=', patch.slug as string).where('id', '!=', id).executeTakeFirst()
    if (taken) ptBadRequest('That campaign address is already used on this site.')
  }
  if ('end_message' in b) patch.end_message = b.end_message ? jsonb(parseText(b.end_message)) : null
  if ('cta' in b) patch.cta = jsonb(ptCta(b.cta))
  if ('description' in b) patch.description = b.description ? jsonb(parseText(b.description)) : null
  if ('landing' in b) {
    const landing = ptLanding(b.landing)
    // The template's standard "why" text shows by default, so it is not stored.
    if (landing.why) landing.why = Object.fromEntries(Object.entries(landing.why).filter(([lang, doc]) => !isTemplateWhy(doc, templateKey, lang)))
    patch.landing = jsonb(landing)
  }
  // `branding` sets the hero image and `share_image_url` the link-preview image; each keeps the other.
  if ('branding' in b || 'share_image_url' in b) {
    const current = (c.branding ?? {}) as CampaignBranding
    const hero = 'branding' in b ? ptCampaignBranding(b.branding) : current
    const shareImage = 'share_image_url' in b ? ptCampaignBranding({ share_image_url: b.share_image_url }).share_image_url : current.share_image_url
    patch.branding = jsonb(ptCampaignBranding({ ...hero, share_image_url: shareImage }))
  }
  if ('share' in b) patch.share = jsonb(ptShare(b.share))
  if (Object.keys(patch).length) await tx.updateTable('pt_campaign').set({ ...patch, updated_at: new Date() } as never).where('id', '=', id).execute()
  return { ok: true }
}

// Every campaign on the site, newest first, with status, length, commitment
// count and goal progress.
export async function ptListCampaigns(tx: Transaction<Database>) {
  const site = await ptSite(tx)
  const rows = (await tx.selectFrom('pt_campaign').selectAll().orderBy('start_date', 'desc').orderBy('created_at', 'desc').execute()).map(normalizeCampaign)
  const counts = await tx.selectFrom('pt_commitment').select(['campaign_id', eb => eb.fn.countAll<string>().as('n')]).groupBy('campaign_id').execute()
  const commitments = new Map(counts.map(r => [r.campaign_id, Number(r.n)]))
  const campaigns = []
  for (const c of rows) {
    campaigns.push({
      ...c,
      status: campaignStatus(c),
      commitments: commitments.get(c.id) ?? 0,
      length: displayLength(c),
      progress: await goalProgress(ptTx(tx), c, site.settings_merged.default_duration_min)
    })
  }
  return { campaigns }
}
