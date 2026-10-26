// Edits a campaign's setup answers, name, address, goal target, end message
// and call to action, and a side campaign's landing page. Existing
// commitments keep their windows.
import { jsonb } from '@prayertools/shared/db/json'
import { parseText } from '@prayertools/shared/translatable'
import { contentLength } from '@prayertools/shared/content'
import { isTemplateWhy } from '@prayertools/shared/i18n/landing'

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
  if ('landing' in b || 'description' in b) {
    if (c.kind !== 'side') ptBadRequest('The main campaign uses the site\'s landing page.')
    ptNeed(ctx, 'pt.site.write')
    if ('description' in b) patch.description = b.description ? jsonb(parseText(b.description)) : null
    if ('landing' in b) {
      const landing = ptLanding(b.landing)
      // The template's standard "why" text shows by default, so it is not stored.
      if (landing.why) landing.why = Object.fromEntries(Object.entries(landing.why).filter(([lang, doc]) => !isTemplateWhy(doc, c.template_key, lang)))
      patch.landing = jsonb(landing)
    }
  }
  if (Object.keys(patch).length) await tx.updateTable('pt_campaign').set({ ...patch, updated_at: new Date() } as never).where('id', '=', id).execute()
  return { ok: true }
})
