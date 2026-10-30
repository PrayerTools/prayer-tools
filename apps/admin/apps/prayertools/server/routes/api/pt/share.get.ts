// What the Share screen needs for one campaign: its live address (custom
// domain once active; the site's root for the current campaign, the
// campaign's own path for any other), QR codes (PNG data URL and SVG), its
// share messages per language and its link-preview image.
import QRCode from 'qrcode'
import type { CampaignBranding, CampaignShare } from '@prayertools/shared/db/schema'
import { siteUrlFor } from '@prayertools/shared/site'
import { platformConfig } from '@prayertools/shared/config'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { campaignById, campaignUrl, loadCampaigns } from '@prayertools/shared/campaigns'

export default definePtHandler('pt.site.read', async (event, tx, ctx) => {
  const site = await ptSite(tx)
  const campaign = await campaignById(ptTx(tx), getQuery(event).campaign, { drafts: true })
  if (!campaign) ptNotFound('Campaign not found.')
  const current = pickCurrentCampaign(await loadCampaigns(ptTx(tx)))?.campaign.id
  const url = campaignUrl(await siteUrlFor(ptTx(tx), ctx.orgId, ctx.orgSlug), campaign, current)
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
