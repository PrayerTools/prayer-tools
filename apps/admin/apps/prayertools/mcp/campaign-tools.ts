// MCP tools for campaigns: creating main and side campaigns (and relaunches),
// reading and editing them, and their landing page.
import { z } from 'zod'
import { createError } from 'h3'
import { defineMcpTool } from '#mcp-layer'
import { campaignById } from '@prayertools/shared/campaigns'
import { HIDEABLE_SECTIONS } from '@prayertools/shared/landing'
import { TEMPLATES } from '@prayertools/shared/setup'
import { parseText, textIn } from '@prayertools/shared/translatable'
import type { CampaignBranding, CampaignLanding, LandingCustomSection } from '@prayertools/shared/db/schema'
import { ptTx } from '../server/utils/pt-context'
import { ptCampaignDetail, ptCreateCampaign, ptUpdateCampaign } from '../server/utils/pt-campaigns'
import { adminLink, audit, blocksDoc, blocksInput, docBlocks, idInput, INEXACT_NOTE, inSite, langInput, orgInput, result, run, siteLanguage, SITE_APP, withText } from './pt-mcp-helpers'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD')

const setupFields = {
  template_key: z.enum(TEMPLATES.map(t => t.key) as [string, ...string[]]).optional()
    .describe('A template pre-fills the setup, e.g. "ramadan" (30 days from a start date). Defaults to "generic".'),
  start_mode: z.enum(['date', 'join']).optional().describe('"date": everyone starts on start_date. "join": each person\'s day 1 is the day they sign up.'),
  start_date: date.nullable().optional(),
  end_mode: z.enum(['date', 'none', 'days']).optional().describe('"date": ends on end_date. "none": ongoing. "days": each person goes through length_days (join start only).'),
  end_date: date.nullable().optional(),
  length_days: z.number().int().min(1).max(3650).nullable().optional(),
  goal: z.enum(['people', 'prayer_time', 'coverage']).optional().describe('"people": people mobilized (recommended). "prayer_time": e.g. 24 hours of prayer every day. "coverage": 24/7, needs start and end dates.'),
  cadence: z.enum(['daily', 'weekly']).optional().describe('How often new prayer content comes.'),
  track_time: z.boolean().optional().describe('For the people goal: also ask how long people pray.')
}

const detailFields = {
  name: z.string().min(2).max(120).optional(),
  slug: z.string().min(2).max(60).optional().describe('The campaign\'s address on the site. Side campaigns get one from their name and year.'),
  timezone: z.string().max(64).optional().describe('IANA timezone; defaults to the site\'s.'),
  place_name: z.string().max(200).nullable().optional().describe('The place prayed for; fills {place} in the content.'),
  people_group: z.string().max(200).nullable().optional().describe('Fills {people_group} in the content.'),
  goal_target: z.number().int().positive().max(9_999_999).nullable().optional().describe('E.g. 500 people, or hours per day for prayer_time.'),
  slot_min: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).nullable().optional().describe('24/7 coverage slot length in minutes; default 15.')
}

const createCampaignTool = defineMcpTool({
  name: 'create_campaign',
  title: 'Create Campaign',
  description: 'Create a campaign on a site. A site runs one main campaign at a time (main campaign dates can\'t overlap); a side campaign (e.g. Ramadan on a site with an ongoing campaign) runs alongside at its own address and needs start and end dates. Pass relaunch_of to run a past campaign again with its setup, content and look. New campaigns are drafts until published in the admin, except a draft site\'s first main campaign, which goes live with the site.',
  appId: SITE_APP,
  scope: 'pt.campaigns.write',
  input: z.object({
    org: orgInput,
    kind: z.enum(['main', 'side']).default('main'),
    relaunch_of: idInput('A past campaign to relaunch.').optional(),
    ...setupFields,
    ...detailFields
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.campaigns.write', async (tx, tenant) => {
    const { org: _org, kind: kindInput, relaunch_of, ...rest } = input
    const kind = kindInput ?? 'main'
    const b: Record<string, unknown> = { ...rest, kind: kind === 'side' ? 'side' : null }
    if (relaunch_of) b.relaunchOf = relaunch_of
    const { campaign } = await ptCreateCampaign(tx, tenant, b)
    await audit(ctx, tx, 'CREATE', 'pt_campaign', campaign.id, { kind, relaunch_of })
    return result(
      `Created ${kind} campaign "${campaign.name}" (${campaign.published_at ? 'live with the site' : 'draft'}). Add its prayer content with add_campaign_content.`,
      { campaign: { id: campaign.id, name: campaign.name, slug: campaign.slug, published: !!campaign.published_at }, adminUrl: adminLink(tenant.orgSlug, `/site/campaigns/${campaign.id}`) }
    )
  }))
})

function text(t: unknown, lang: string): string | null {
  return textIn(parseText(t), lang) || null
}

const getCampaignTool = defineMcpTool({
  name: 'get_campaign',
  title: 'Get Campaign',
  description: 'One campaign\'s setup, place, goal progress, description, share messages and call to action (texts in one language), and its stacked content libraries.',
  appId: SITE_APP,
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({ org: orgInput, campaign: idInput('Campaign id from get_site_overview.'), language: langInput }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.read', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const { campaign: c, libraries } = await ptCampaignDetail(tx, input.campaign)
    const branding = (c.branding ?? {}) as CampaignBranding
    return result(`${c.name}: ${c.status}.`, {
      language: lang,
      campaign: {
        id: c.id,
        name: c.name,
        slug: c.slug,
        kind: c.kind ?? 'main',
        status: c.status,
        published: !!c.published_at,
        template: c.template_key,
        startMode: c.start_mode,
        startDate: c.start_date,
        endMode: c.end_mode,
        endDate: c.end_date,
        lengthDays: c.length_days,
        goal: c.goal,
        goalTarget: c.goal_target,
        cadence: c.cadence,
        trackTime: c.track_time,
        timezone: c.timezone,
        placeName: c.place_name,
        peopleGroup: c.people_group,
        entries: c.entries,
        contentEntries: c.contentEntries,
        commitments: c.commitments,
        progress: c.progress,
        description: text(c.description, lang),
        shareMessages: text((c.share as { messages?: unknown } | null)?.messages, lang),
        endMessage: text(c.end_message, lang),
        cta: (c.cta as { url?: string, label?: unknown } | null)?.url ? { url: (c.cta as { url: string }).url, label: text((c.cta as { label?: unknown }).label, lang) } : null,
        heroImage: branding.image_url ? { src: branding.image_url, alt: textIn(branding.image_alt, lang) } : null,
        shareImageUrl: branding.share_image_url ?? null
      },
      libraries,
      adminUrl: adminLink(tenant.orgSlug, `/site/campaigns/${c.id}`)
    })
  }))
})

const imageInput = z.object({
  src: z.string().url().optional(),
  assetId: z.string().uuid().optional().describe('An image from list_images.'),
  alt: z.string().max(500).optional().describe('Required unless the image comes from list_images with alt text.')
}).strict()

async function heroBranding(userId: string, lang: string, current: CampaignBranding, image: z.infer<typeof imageInput> | null): Promise<Record<string, unknown>> {
  const { share_image_url: _share, ...hero } = current
  if (image === null) return {}
  const doc = await blocksDoc(userId, lang, [{ type: 'image', ...image }])
  const attrs = doc.content?.[0]?.attrs as { src: string, alt: string }
  return { ...hero, image_url: attrs.src, image_asset_id: image.assetId, image_alt: withText(current.image_alt, lang, attrs.alt) }
}

const updateCampaignTool = defineMcpTool({
  name: 'update_campaign',
  title: 'Update Campaign',
  description: 'Change a campaign\'s setup, name, place, goal target, description, share messages, end-of-campaign message, call to action or hero image. Only the fields you pass change; texts are written in `language` and mark the site\'s other languages out of date when it is the default language. Existing prayer commitments keep their times.',
  appId: SITE_APP,
  scope: 'pt.campaigns.write',
  input: z.object({
    org: orgInput,
    campaign: idInput('Campaign id from get_site_overview.'),
    language: langInput,
    ...setupFields,
    ...detailFields,
    description: z.string().max(2000).nullable().optional().describe('Short description on the landing page.'),
    share_messages: z.string().max(4000).optional().describe('Suggested messages people share to invite others, one per paragraph.'),
    end_message: z.string().max(4000).nullable().optional().describe('Shown when the campaign has ended.'),
    cta: z.object({ url: z.string().url(), label: z.string().min(1).max(120) }).strict().nullable().optional().describe('Call to action shown after the campaign; null removes it.'),
    hero_image: imageInput.nullable().optional().describe('The landing page\'s hero image; null removes it.'),
    share_image_url: z.string().url().nullable().optional().describe('Link-preview image.')
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.campaigns.write', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const c = await campaignById(ptTx(tx), input.campaign, { drafts: true })
    if (!c) throw createError({ statusCode: 404, statusMessage: 'Campaign not found.' })
    const { org: _o, campaign: _c, language: _l, description, share_messages, end_message, cta, hero_image, share_image_url, ...rest } = input
    const b: Record<string, unknown> = { ...rest }
    if (description !== undefined) b.description = description === null ? null : withText(parseText(c.description), lang, description)
    if (share_messages !== undefined) b.share = { messages: withText(parseText((c.share as { messages?: unknown } | null)?.messages), lang, share_messages) }
    if (end_message !== undefined) b.end_message = end_message === null ? null : withText(parseText(c.end_message), lang, end_message)
    if (cta !== undefined) b.cta = cta === null ? {} : { url: cta.url, label: withText(parseText((c.cta as { label?: unknown } | null)?.label), lang, cta.label) }
    if (hero_image !== undefined) b.branding = await heroBranding(ctx.auth.userId, lang, (c.branding ?? {}) as CampaignBranding, hero_image)
    if (share_image_url !== undefined) b.share_image_url = share_image_url
    await ptUpdateCampaign(tx, tenant, c.id, b)
    await audit(ctx, tx, 'UPDATE', 'pt_campaign', c.id, { fields: Object.keys(b) })
    return result('Campaign updated.', { ok: true, adminUrl: adminLink(tenant.orgSlug, `/site/campaigns/${c.id}`) })
  }))
})

const getLandingTool = defineMcpTool({
  name: 'get_landing_page',
  title: 'Get Landing Page',
  description: 'A campaign\'s landing page in one language: the "why pray" text, the custom sections, which standard sections are hidden, and whether stories show.',
  appId: SITE_APP,
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({ org: orgInput, campaign: idInput('Campaign id from get_site_overview.'), language: langInput }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.read', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const c = await campaignById(ptTx(tx), input.campaign, { drafts: true })
    if (!c) throw createError({ statusCode: 404, statusMessage: 'Campaign not found.' })
    const landing = (c.landing ?? {}) as CampaignLanding
    const why = landing.why?.[lang] ? docBlocks(landing.why[lang]) : null
    const custom = (landing.custom ?? []).map((s) => {
      const body = s.body[lang] ? docBlocks(s.body[lang]) : null
      return {
        id: s.id,
        heading: textIn(s.heading, lang),
        body: body?.blocks ?? [],
        exact: body?.exact ?? true,
        imageUrl: s.image_url ?? null,
        imageAlt: s.image_alt ? textIn(s.image_alt, lang) : null,
        videoUrl: s.video_url ?? null,
        buttonLabel: s.button_label ? textIn(s.button_label, lang) : null,
        buttonUrl: s.button_url ?? null
      }
    })
    const inexact = (why && !why.exact) || custom.some(s => !s.exact)
    return result(`Landing page of ${c.name}${inexact ? `. ${INEXACT_NOTE}` : '.'}`, {
      language: lang,
      why: why ? { blocks: why.blocks, exact: why.exact } : null,
      whyUsesTemplateText: !landing.why?.[lang],
      custom,
      hidden: landing.hidden ?? null,
      hideableSections: HIDEABLE_SECTIONS,
      stories: landing.stories ?? null,
      adminUrl: adminLink(tenant.orgSlug, '/site/landing')
    })
  }))
})

const sectionInput = z.object({
  id: z.string().max(40).optional().describe('An existing section\'s id from get_landing_page; leave out for a new section.'),
  heading: z.string().min(1).max(200),
  body: blocksInput.optional(),
  image: imageInput.optional(),
  video_url: z.string().url().optional().describe('YouTube or Vimeo.'),
  button_label: z.string().max(120).optional(),
  button_url: z.string().url().optional()
}).strict()

const updateLandingTool = defineMcpTool({
  name: 'update_landing_page',
  title: 'Update Landing Page',
  description: 'Change a campaign\'s landing page in one language. `why` replaces the "why pray" text (null goes back to the template\'s standard text). `custom` replaces the whole list of custom sections, in order: keep a section by passing its id, drop it by leaving it out. `hidden` lists standard sections to hide. Fields you leave out stay as they are.',
  appId: SITE_APP,
  scope: 'pt.site.write',
  input: z.object({
    org: orgInput,
    campaign: idInput('Campaign id from get_site_overview.'),
    language: langInput,
    why: blocksInput.nullable().optional(),
    custom: z.array(sectionInput).max(12).optional(),
    hidden: z.array(z.enum(HIDEABLE_SECTIONS as unknown as [string, ...string[]])).optional(),
    stories: z.boolean().optional().describe('Show intercessors\' stories on the landing page.')
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.write', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const c = await campaignById(ptTx(tx), input.campaign, { drafts: true })
    if (!c) throw createError({ statusCode: 404, statusMessage: 'Campaign not found.' })
    const userId = ctx.auth.userId
    const landing = { ...((c.landing ?? {}) as CampaignLanding) }
    if (input.why !== undefined) {
      const why = Object.fromEntries(Object.entries(landing.why ?? {}).filter(([l]) => l !== lang))
      if (input.why !== null) why[lang] = await blocksDoc(userId, lang, input.why)
      landing.why = why
    }
    if (input.custom) {
      const existing = landing.custom ?? []
      const custom: LandingCustomSection[] = []
      for (const s of input.custom) {
        const prev = s.id ? existing.find(e => e.id === s.id) : undefined
        if (s.id && !prev) throw createError({ statusCode: 400, statusMessage: `No custom section ${s.id} on this landing page.` })
        const image = s.image ? (await blocksDoc(userId, lang, [{ type: 'image', ...s.image }])).content?.[0]?.attrs as { src: string, alt: string } : null
        custom.push({
          id: prev?.id ?? crypto.randomUUID(),
          heading: withText(prev?.heading, lang, s.heading),
          body: s.body ? { ...prev?.body, [lang]: await blocksDoc(userId, lang, s.body) } : (prev?.body ?? {}),
          image_url: image ? image.src : prev?.image_url,
          image_alt: image ? withText(prev?.image_alt, lang, image.alt) : prev?.image_alt,
          video_url: s.video_url ?? prev?.video_url,
          button_label: s.button_label !== undefined ? withText(prev?.button_label, lang, s.button_label) : prev?.button_label,
          button_url: s.button_url ?? prev?.button_url
        } as LandingCustomSection)
      }
      landing.custom = custom
    }
    if (input.hidden) landing.hidden = input.hidden
    if (input.stories !== undefined) landing.stories = input.stories
    await ptUpdateCampaign(tx, tenant, c.id, { landing })
    await audit(ctx, tx, 'UPDATE', 'pt_campaign', c.id, { landing: Object.keys(input).filter(k => ['why', 'custom', 'hidden', 'stories'].includes(k)) })
    return result('Landing page updated.', { ok: true, adminUrl: adminLink(tenant.orgSlug, '/site/landing') })
  }))
})

export const campaignTools = [
  createCampaignTool,
  getCampaignTool,
  updateCampaignTool,
  getLandingTool,
  updateLandingTool
]
