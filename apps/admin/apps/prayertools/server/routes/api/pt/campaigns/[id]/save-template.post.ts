// "Save as template": keeps the campaign's setup answers, landing page, hero
// image, end message, call to action and libraries in the caller's personal
// library, as a new template or over one they own or edit (`replace_id`).
import { withUserContext } from '#core/server/utils/personal-apps'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'
import { replacePersonalTemplate, savePersonalTemplate, templateFromCampaign } from '@prayertools/shared/personal-templates'

export default definePtHandler('pt.campaigns.write', async (event, tx, ctx) => {
  const b = await ptBody<{ name?: unknown, replace_id?: unknown }>(event)
  const content = await templateFromCampaign(ptTx(tx), getRouterParam(event, 'id')!)
  if (!content) ptNotFound('Campaign not found.')
  if (typeof b.replace_id === 'string') {
    const id = b.replace_id
    const ok = await withUserContext(event, { appId: PT_LIBRARY_APP }, utx => replacePersonalTemplate(ptTx(utx), id, content))
    if (!ok) ptNotFound('Template not found.')
    return { id }
  }
  const name = String(b.name ?? '').trim()
  if (name.length < 2 || name.length > 120) ptBadRequest('Template name must be 2–120 characters.')
  const id = await withUserContext(event, { appId: PT_LIBRARY_APP }, utx => savePersonalTemplate(ptTx(utx), ctx.userId, name, content))
  return { id }
})
