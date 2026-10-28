// Creates a campaign on the site. `relaunchOf` starts from a previous
// campaign's answers and reuses its libraries (copies the site edited carry
// over; followed libraries pick up their latest published version), its kind,
// landing page, images and share messages. Any other campaign takes its
// images and share messages from the latest main campaign, and a main
// campaign its landing page too, so the site's root page keeps its look.
import { suggestCampaignSlug, suggestSideSlug } from '@prayertools/shared/setup'
import { jsonb } from '@prayertools/shared/db/json'
import { parseText } from '@prayertools/shared/translatable'

export default definePtHandler('pt.campaigns.write', async (event, tx, ctx) => {
  const b = await ptBody(event)
  const site = await ptSite(tx)
  let base: Record<string, unknown> | undefined
  let templateKey = typeof b.template_key === 'string' ? b.template_key : (site.template_key ?? 'generic')
  let previous: Awaited<ReturnType<typeof loadPrev>> | undefined
  async function loadPrev(id: string) {
    return await tx.selectFrom('pt_campaign').selectAll().where('id', '=', id).executeTakeFirst()
  }
  if (typeof b.relaunchOf === 'string') {
    previous = await loadPrev(b.relaunchOf)
    if (!previous) ptNotFound('Campaign not found.')
    const p = ptCampaignOut(previous)
    templateKey = previous.template_key ?? 'generic'
    base = { start_mode: p.start_mode, end_mode: p.end_mode, length_days: p.length_days, goal: p.goal, cadence: p.cadence, track_time: p.track_time }
    if (p.start_mode === 'date' && p.start_date && p.end_date && !('end_date' in b) && typeof b.start_date === 'string') {
      const days = (Date.parse(p.end_date) - Date.parse(p.start_date)) / 86_400_000
      b.end_date = new Date(Date.parse(b.start_date) + days * 86_400_000).toISOString().slice(0, 10)
    }
  }
  const kind = previous ? previous.kind : ptCampaignKind(b.kind)
  const answers = ptSetupFromBody(b, templateKey, base as never, kind)
  const extras = ptCampaignExtras(b)
  const timezone = (extras.timezone as string) ?? site.timezone
  await ptAssertNoOverlap(tx, { ...answers, timezone }, kind)
  const name = (extras.name as string) ?? previous?.name ?? ctx.orgName
  const taken = (await tx.selectFrom('pt_campaign').select('slug').execute()).map(r => r.slug)
  const slug = (extras.slug as string) ?? (kind === 'side' ? suggestSideSlug(name, answers.start_date, taken) : suggestCampaignSlug(answers.start_date, taken))
  if (taken.includes(slug)) ptBadRequest('That campaign address is already used on this site.')
  const look = previous ?? await tx.selectFrom('pt_campaign').select(['landing', 'branding', 'share']).where('kind', 'is', null)
    .orderBy('start_date', ob => ob.desc().nullsLast()).orderBy('created_at', 'desc').executeTakeFirst()
  const created = await tx.insertInto('pt_campaign').values({
    slug,
    name,
    template_key: templateKey,
    kind,
    ...answers,
    timezone,
    goal_target: (extras.goal_target as number | null | undefined) ?? previous?.goal_target ?? null,
    slot_min: 'slot_min' in extras ? extras.slot_min as number | null : (previous?.slot_min ?? null),
    end_message: b.end_message ? jsonb(parseText(b.end_message)) : (previous?.end_message ? jsonb(previous.end_message) : null),
    cta: jsonb(b.cta ? ptCta(b.cta) : (previous?.cta ?? {})),
    landing: jsonb(look && (previous || kind !== 'side') ? look.landing : {}),
    branding: jsonb(look?.branding ?? {}),
    share: jsonb(look?.share ?? {}),
    description: previous?.description ? jsonb(previous.description) : null,
    // A campaign starts as a draft, except on a site still being set up, which is itself unpublished.
    published_at: site.status === 'draft' ? new Date() : null
  } as never).returningAll().executeTakeFirstOrThrow()
  if (previous) {
    const libs = await tx.selectFrom('pt_campaign_library').select(['site_library_id', 'position']).where('campaign_id', '=', previous.id).execute()
    if (libs.length) await tx.insertInto('pt_campaign_library').values(libs.map(l => ({ campaign_id: created.id, site_library_id: l.site_library_id, position: l.position }))).execute()
  }
  return { campaign: ptCampaignOut(created) }
})
