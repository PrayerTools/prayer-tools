// What the Share screen needs for one campaign: its live address (custom
// domain once active; a side campaign's own path), QR codes (PNG data URL and
// SVG), its share messages per language and its link-preview image.
import QRCode from 'qrcode'
import type { CampaignBranding, CampaignShare } from '@prayertools/shared/db/schema'
import { siteUrlFor } from '@prayertools/shared/site'
import { platformConfig } from '@prayertools/shared/config'

export default definePtHandler('pt.site.read', async (event, tx, ctx) => {
  const site = await ptSite(tx)
  const id = getQuery(event).campaign
  const campaign = typeof id === 'string'
    ? await tx.selectFrom('pt_campaign').select(['id', 'slug', 'kind', 'branding', 'share']).where('id', '=', id).executeTakeFirst()
    : undefined
  if (!campaign) ptNotFound('Campaign not found.')
  const base = await siteUrlFor(ptTx(tx), ctx.orgId, ctx.orgSlug)
  const url = campaign.kind === 'side' ? `${base}/${campaign.slug}` : base
  const [png, svg] = await Promise.all([
    QRCode.toDataURL(url, { width: 1024, margin: 2 }),
    QRCode.toString(url, { type: 'svg', margin: 2 })
  ])
  return {
    url,
    qrPng: png,
    qrSvg: svg,
    share: campaign.share as CampaignShare,
    shareImageUrl: (campaign.branding as CampaignBranding).share_image_url ?? null,
    languages: site.languages,
    defaultLanguage: site.default_language,
    donateUrl: platformConfig().donateUrl
  }
})
