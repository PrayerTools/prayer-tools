import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import type { CampaignBranding, CampaignLanding, TranslatableText } from '@prayertools/shared/db/schema'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { LANGUAGES } from '@prayertools/shared/languages'
import { landingWhyDoc } from '@prayertools/shared/i18n/landing'
import { hasPlacePhrases, RELIABLE_PLACE_LANGUAGES, type SitePlaceWording } from '@prayertools/shared/place'

export interface PtChecklistItem {
  key: string
  label: string
  done: boolean
  // Publishing waits for required items; the others are recommendations.
  required: boolean
  // Not needed to publish, but flagged until done.
  important?: boolean
  detail?: string
  // Admin page that fixes it, relative to the site.
  to: string
}

const hasText = (t: TranslatableText | null | undefined) => Object.values(t?.values ?? {}).some(v => !!v?.trim())

// What a site needs before (and soon after) it goes live, for its current
// campaign, or for the campaign `campaignId` before it is published.
export async function ptLaunchChecklist(tx: Transaction<Database>, campaignId?: string): Promise<PtChecklistItem[]> {
  const site = await ptSite(tx)
  const campaigns = (await tx.selectFrom('pt_campaign').selectAll().execute()).map(ptCampaignOut)
  const campaign = campaignId
    ? campaigns.find(c => c.id === campaignId) ?? null
    : pickCurrentCampaign(campaigns)?.campaign ?? campaigns[0] ?? null
  const libraries = campaign ? await ptCampaignLibraries(tx, campaign.id, site.languages) : []
  const entries = libraries.reduce((n, l) => n + l.entryCount, 0)
  const missing = [...new Set(libraries.flatMap(l => l.missingLanguages))]
  const landing = (campaign?.landing ?? {}) as CampaignLanding
  const branding = (campaign?.branding ?? {}) as CampaignBranding
  const placeWording = (site.place_wording ?? {}) as SitePlaceWording
  const usesPlacePhrases = !!campaign && !!site.place_name && await ptCampaignUsesPlacePhrases(tx, campaign.id)
  const unworded = (site.languages as string[]).filter(l => !RELIABLE_PLACE_LANGUAGES.includes(l) && !hasPlacePhrases(placeWording, l))
  const forCampaign = campaign ? `?campaign=${campaign.id}` : ''
  // A side campaign has its own template and description; the main campaign uses the site's.
  const side = campaign?.kind === 'side'
  const templateKey = side ? campaign.template_key : site.template_key
  const description = (side ? campaign.description : site.description) as TranslatableText | null
  const datesDone = !!campaign && (campaign.start_mode === 'join' || (!!campaign.start_date && (campaign.end_mode !== 'date' || !!campaign.end_date)))

  return [
    {
      key: 'dates',
      label: campaign?.start_mode === 'join' ? 'Campaign start and length set' : 'Campaign start and end dates set',
      done: datesDone,
      required: true,
      to: campaign ? `/site/campaigns/${campaign.id}` : '/site/campaigns/new'
    },
    {
      key: 'content',
      label: libraries.length ? 'Prayer content written' : 'Prayer content chosen',
      done: entries > 0,
      required: false,
      important: true,
      detail: entries > 0 ? `${entries} ${entries === 1 ? 'entry' : 'entries'}` : libraries.length ? 'No entries yet' : undefined,
      to: `/site/content${forCampaign}`
    },
    {
      key: 'content_languages',
      label: 'Prayer content in every site language',
      done: entries > 0 && missing.length === 0,
      required: false,
      detail: missing.length ? `Missing: ${missing.map(l => LANGUAGES.find(x => x.code === l)?.name ?? l).join(', ')}` : undefined,
      to: `/site/content${forCampaign}`
    },
    ...(usesPlacePhrases
      ? [{
          key: 'place_wording',
          label: 'Place wording checked in every language',
          done: unworded.length === 0,
          required: false,
          detail: unworded.length ? `Check: ${unworded.map(l => LANGUAGES.find(x => x.code === l)?.name ?? l).join(', ')}` : undefined,
          to: '/site/settings'
        }]
      : []),
    {
      key: 'why',
      label: '"Why we pray" written',
      done: !!landingWhyDoc(landing.why, templateKey, site.default_language, site.default_language),
      required: false,
      to: `/site/landing${forCampaign}`
    },
    {
      key: 'description',
      label: 'Short description written',
      done: hasText(description),
      required: false,
      to: `/site/landing${forCampaign}`
    },
    {
      key: 'image',
      label: 'Hero image chosen',
      done: !!branding.image_url,
      required: false,
      to: `/site/landing${forCampaign}`
    }
  ]
}
