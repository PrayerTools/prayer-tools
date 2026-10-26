// Translators edit one language of the site's translatable text without
// write access to the rest of the site: a language other than the text's
// source language. With `campaignId`, the text is a side campaign's landing
// page.
import type { SiteLanding, SiteShare, TranslatableText, TiptapDoc } from '@prayertools/shared/db/schema'
import { setText } from '@prayertools/shared/translatable'
import { jsonb } from '@prayertools/shared/db/json'
import { isTemplateWhy } from '@prayertools/shared/i18n/landing'

export default definePtHandler('pt.content.translate', async (event, tx, ctx) => {
  const b = await ptBody<{ field?: string, lang?: string, value?: unknown, sectionId?: string, part?: string, campaignId?: string }>(event)
  const site = await ptSite(tx)
  const lang = String(b.lang ?? '')
  if (!site.languages.includes(lang)) ptBadRequest('Not a site language.')
  const canWriteSource = ctx.perms.has('pt.site.write' as never)
  const guard = (t: TranslatableText | null | undefined) => {
    if (!canWriteSource && t && t.source === lang) throw createError({ statusCode: 403, statusMessage: 'Translators edit other languages only.' })
  }
  let landing = site.landing as SiteLanding
  let description = site.description as TranslatableText | null
  let templateKey = site.template_key
  const columns = (patch: { landing?: SiteLanding, description?: TranslatableText | null }) => {
    const out: Record<string, unknown> = {}
    if (patch.landing) out.landing = jsonb(patch.landing)
    if ('description' in patch) out.description = jsonb(patch.description)
    return out
  }
  let write = async (patch: { landing?: SiteLanding, description?: TranslatableText | null }) => {
    await tx.updateTable('pt_site').set(columns(patch)).where('org_id', '=', ctx.orgId).execute()
  }
  if (b.campaignId) {
    const campaign = await tx.selectFrom('pt_campaign').select(['id', 'kind', 'landing', 'description', 'template_key']).where('id', '=', String(b.campaignId)).executeTakeFirst()
    if (!campaign || campaign.kind !== 'side') ptNotFound('Campaign not found.')
    if (b.field === 'share') ptBadRequest('Unknown field.')
    landing = (campaign.landing ?? {}) as SiteLanding
    description = campaign.description as TranslatableText | null
    templateKey = campaign.template_key
    write = async (patch) => {
      await tx.updateTable('pt_campaign').set({ ...columns(patch), updated_at: new Date() }).where('id', '=', campaign.id).execute()
    }
  }
  if (b.field === 'description') {
    guard(description)
    await write({ description: setText(description, lang, String(b.value ?? '')) })
  } else if (b.field === 'share') {
    const share = site.share as SiteShare
    guard(share.messages)
    await tx.updateTable('pt_site').set({ share: jsonb({ ...share, messages: setText(share.messages, lang, String(b.value ?? '')) }) }).where('org_id', '=', ctx.orgId).execute()
  } else if (b.field === 'why') {
    if (!canWriteSource && lang === site.default_language) throw createError({ statusCode: 403, statusMessage: 'Translators edit other languages only.' })
    const doc = ptDoc(b.value)
    const { [lang]: _previous, ...others } = landing.why ?? {}
    const why = isTemplateWhy(doc, templateKey, lang) ? others : { ...others, [lang]: doc ?? { type: 'doc', content: [] } }
    await write({ landing: { ...landing, why } })
  } else if (b.field === 'custom') {
    const custom = (landing.custom ?? []).map((s) => {
      if (s.id !== b.sectionId) return s
      if (b.part === 'body') {
        if (!canWriteSource && lang === s.heading.source) throw createError({ statusCode: 403, statusMessage: 'Translators edit other languages only.' })
        return { ...s, body: { ...s.body, [lang]: ptDoc(b.value) as TiptapDoc } }
      }
      const key = b.part === 'button_label' ? 'button_label' : b.part === 'image_alt' ? 'image_alt' : 'heading'
      guard(s[key])
      return { ...s, [key]: setText(s[key], lang, String(b.value ?? '')) }
    })
    await write({ landing: { ...landing, custom } })
  } else {
    ptBadRequest('Unknown field.')
  }
  return { ok: true }
})
