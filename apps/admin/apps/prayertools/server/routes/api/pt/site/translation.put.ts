// Translators edit one language of a campaign's landing page and share
// messages, or the site's short description, without write access to the rest
// of the site: a language other than the text's source language. A side
// campaign's description is its own.
import type { CampaignLanding, CampaignShare, TranslatableText, TiptapDoc } from '@prayertools/shared/db/schema'
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
  const campaign = b.campaignId
    ? await tx.selectFrom('pt_campaign').select(['id', 'kind', 'landing', 'share', 'description', 'template_key']).where('id', '=', String(b.campaignId)).executeTakeFirst()
    : undefined
  if (b.campaignId && !campaign) ptNotFound('Campaign not found.')
  const side = campaign?.kind === 'side'
  const landing = (campaign?.landing ?? {}) as CampaignLanding
  const share = (campaign?.share ?? {}) as CampaignShare
  const description = (side ? campaign!.description : site.description) as TranslatableText | null
  const templateKey = side ? campaign!.template_key : site.template_key
  const writeCampaign = async (patch: { landing?: CampaignLanding, share?: CampaignShare, description?: TranslatableText | null }) => {
    if (!campaign) ptBadRequest('Choose a campaign.')
    const out: Record<string, unknown> = { updated_at: new Date() }
    for (const [k, v] of Object.entries(patch)) out[k] = jsonb(v)
    await tx.updateTable('pt_campaign').set(out).where('id', '=', campaign!.id).execute()
  }
  if (b.field === 'description') {
    guard(description)
    const next = setText(description, lang, String(b.value ?? ''))
    if (side) await writeCampaign({ description: next })
    else await tx.updateTable('pt_site').set({ description: jsonb(next) }).where('org_id', '=', ctx.orgId).execute()
  } else if (b.field === 'share') {
    guard(share.messages)
    await writeCampaign({ share: { ...share, messages: setText(share.messages, lang, String(b.value ?? '')) } })
  } else if (b.field === 'why') {
    if (!canWriteSource && lang === site.default_language) throw createError({ statusCode: 403, statusMessage: 'Translators edit other languages only.' })
    const doc = ptDoc(b.value)
    const { [lang]: _previous, ...others } = landing.why ?? {}
    const why = isTemplateWhy(doc, templateKey, lang) ? others : { ...others, [lang]: doc ?? { type: 'doc', content: [] } }
    await writeCampaign({ landing: { ...landing, why } })
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
    await writeCampaign({ landing: { ...landing, custom } })
  } else {
    ptBadRequest('Unknown field.')
  }
  return { ok: true }
})
