// Edits a campaign's setup answers, name, address, goal target, end message
// and call to action, and its landing page, images and share messages. A side
// campaign also has its own short description; the main campaign uses the
// site's. Existing commitments keep their windows.
import { jsonb } from '@prayertools/shared/db/json'
import { parseText } from '@prayertools/shared/translatable'
import { contentLength } from '@prayertools/shared/content'
import { isTemplateWhy } from '@prayertools/shared/i18n/landing'
import type { CampaignBranding } from '@prayertools/shared/db/schema'

export default definePtHandler('pt.campaigns.write', async (event, tx, ctx) => {
  const id = getRouterParam(event, 'id')!
  const b = await ptBody(event)
  const row = await tx.selectFrom('pt_campaign').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) ptNotFound('Campaign not found.')
  const c = ptCampaignOut(row)
  const patch: Record<string, unknown> = ptCampaignExtras(b)
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
  if (['landing', 'description', 'branding', 'share_image_url', 'share'].some(k => k in b)) ptNeed(ctx, 'pt.site.write')
  if ('description' in b) {
    if (c.kind !== 'side') ptBadRequest('The main campaign uses the site\'s description.')
    patch.description = b.description ? jsonb(parseText(b.description)) : null
  }
  if ('landing' in b) {
    const landing = ptLanding(b.landing)
    // The template's standard "why" text shows by default, so it is not stored.
    const templateKey = c.kind === 'side' ? c.template_key : (await ptSite(tx)).template_key
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
})
