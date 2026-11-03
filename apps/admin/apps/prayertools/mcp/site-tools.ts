// MCP tools for a site as a whole: creating one, its overview and settings,
// the preview link, stats, and the signup form's questions and consent options.
import { z } from 'zod'
import { createError } from 'h3'
import { defineMcpTool, mcpLog } from '#mcp-layer'
import { rateLimit } from '@prayertools/shared/rate-limit'
import { siteUrlFor } from '@prayertools/shared/site'
import { campaignById } from '@prayertools/shared/campaigns'
import { goalProgress, prayingNow, statTotals } from '@prayertools/shared/stats'
import { campaignStatus } from '@prayertools/shared/setup'
import { parseText, textIn } from '@prayertools/shared/translatable'
import type { TranslatableText } from '@prayertools/shared/db/schema'
import { ptSite, ptTx } from '../server/utils/pt-context'
import { ptCreateSite, ptFreeSlug, ptNewPreviewLink, ptSlugTaken, ptUpdateSite, ptValidateSiteInput } from '../server/utils/pt-sites'
import { ptListCampaigns } from '../server/utils/pt-campaigns'
import { ptLaunchChecklist } from '../server/utils/pt-checklist'
import { ptCreateConsentOption, ptCreateSignupField, ptUpdateConsentOption, ptUpdateSignupField } from '../server/utils/pt-signup'
import { adminLink, audit, idInput, inSite, langInput, orgInput, result, run, siteLanguage, SITE_APP, withText } from './pt-mcp-helpers'

const languageCode = z.string().regex(/^[a-z]{2,3}(-[a-z]{2,4})?$/)

const createSiteTool = defineMcpTool({
  name: 'create_site',
  title: 'Create Site',
  description: 'Create a new prayer site, as a draft that only you and your team can see. You become its owner. Then add a campaign with create_campaign and its prayer content; publishing happens in the admin.',
  scope: 'pt.sites.create',
  input: z.object({
    name: z.string().min(2).max(80).describe('The site\'s name, e.g. the people, place or event it prays for.'),
    slug: z.string().min(3).max(40).optional().describe('Address: <slug>.prayer.tools. Lowercase letters, digits and hyphens. Derived from the name when left out.'),
    languages: z.array(languageCode).min(1).max(10).optional().describe('Site languages. Defaults to ["en"].'),
    default_language: languageCode.optional().describe('The language content is written in first. Defaults to the first language.'),
    timezone: z.string().max(64).optional().describe('IANA timezone, e.g. "Africa/Casablanca". Defaults to UTC.')
  }).strict(),
  handler: (input, ctx) => run(async () => {
    const userId = ctx.auth.userId
    if (!rateLimit(`site-create:${userId}`, 10, 3600_000).ok) {
      throw createError({ statusCode: 429, statusMessage: 'Too many sites created. Try again later.' })
    }
    const name = input.name.trim()
    const site = {
      name,
      slug: input.slug?.trim().toLowerCase() || await ptFreeSlug(name),
      languages: input.languages ?? ['en'],
      default_language: input.default_language,
      timezone: input.timezone ?? 'UTC'
    }
    const errors = ptValidateSiteInput(site)
    if (Object.keys(errors).length) throw createError({ statusCode: 400, statusMessage: Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(' ') })
    if (await ptSlugTaken(site.slug)) throw createError({ statusCode: 409, statusMessage: `The address "${site.slug}" is already taken.` })
    const created = await ptCreateSite(userId, site)
    await mcpLog('CREATE', 'orgs', created.id, ctx, { slug: created.slug })
    return result(
      `Created the draft site "${created.name}" at ${created.slug}. Pass org: "${created.slug}" to the other tools.`,
      { site: created, adminUrl: adminLink(created.slug, '/site') }
    )
  })
})

const overviewTool = defineMcpTool({
  name: 'get_site_overview',
  title: 'Get Site Overview',
  description: 'A site\'s settings, languages, status and address, its campaigns with their status and progress, and the launch checklist. Start here before changing a site.',
  appId: SITE_APP,
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({ org: orgInput }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.read', async (tx, tenant) => {
    const site = await ptSite(tx)
    const { campaigns } = await ptListCampaigns(tx)
    const checklist = await ptLaunchChecklist(tx)
    return result(
      `${tenant.orgName}: ${site.status}, ${campaigns.length} campaign(s).`,
      {
        site: {
          id: tenant.orgId,
          slug: tenant.orgSlug,
          name: tenant.orgName,
          status: site.status,
          languages: site.languages,
          defaultLanguage: site.default_language,
          timezone: site.timezone,
          branding: site.branding,
          settings: site.settings_merged
        },
        url: await siteUrlFor(ptTx(tx), tenant.orgId, tenant.orgSlug),
        adminUrl: adminLink(tenant.orgSlug, '/site'),
        campaigns: campaigns.map(c => ({
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
          cadence: c.cadence,
          commitments: c.commitments,
          progress: c.progress
        })),
        checklist: checklist.map(({ to, ...item }) => ({ ...item, adminUrl: adminLink(tenant.orgSlug, to) })),
        canPublish: checklist.every(i => !i.required || i.done)
      }
    )
  }))
})

const settingsInput = z.object({
  checkins_enabled: z.boolean().optional(),
  show_people_count: z.boolean().optional(),
  show_praying_now: z.boolean().optional(),
  default_duration_min: z.number().int().min(1).max(240).optional(),
  share_prompts: z.boolean().optional(),
  auto_ack_contact: z.boolean().optional()
}).strict()

const updateSiteTool = defineMcpTool({
  name: 'update_site',
  title: 'Update Site',
  description: 'Change a site\'s name, timezone, languages, brand color, logo or display settings. Only the fields you pass change.',
  appId: SITE_APP,
  scope: 'pt.site.write',
  input: z.object({
    org: orgInput,
    name: z.string().min(2).max(80).optional(),
    timezone: z.string().max(64).optional(),
    languages: z.array(languageCode).min(1).max(10).optional(),
    default_language: languageCode.optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional().describe('Brand color as hex, e.g. "#1d4ed8".'),
    logo_url: z.string().url().nullable().optional().describe('Logo image URL, e.g. from list_images; null removes it.'),
    settings: settingsInput.optional()
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.write', async (tx, tenant) => {
    const site = await ptSite(tx)
    const { org: _org, color, logo_url, ...b } = input
    const body: Record<string, unknown> = { ...b }
    if (color !== undefined || logo_url !== undefined) {
      const branding = { ...(site.branding as Record<string, unknown>) }
      if (color !== undefined) branding.color = color
      if (logo_url !== undefined) {
        branding.logo_url = logo_url ?? undefined
        delete branding.logo_asset_id
      }
      body.branding = branding
    }
    await ptUpdateSite(tx, tenant, body)
    await audit(ctx, tx, 'UPDATE', 'pt_site', tenant.orgId, { fields: Object.keys(body) })
    return result('Site updated.', { ok: true, adminUrl: adminLink(tenant.orgSlug, '/site/settings') })
  }))
})

const previewLinkTool = defineMcpTool({
  name: 'get_preview_link',
  title: 'Get Preview Link',
  description: 'A link to preview a draft site as visitors will see it. Each new link replaces the previous one.',
  appId: SITE_APP,
  scope: 'pt.site.read',
  input: z.object({ org: orgInput }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.read', async (tx, tenant) => {
    const url = await ptNewPreviewLink(tx, tenant)
    return result(`Preview: ${url}`, { url })
  }))
})

const statsTool = defineMcpTool({
  name: 'get_site_stats',
  title: 'Get Site Stats',
  description: 'Counts for a campaign, or the whole site: people praying, goal progress, commitments, prayer activity totals and how many are praying now. No personal data.',
  appId: SITE_APP,
  scope: 'pt.stats.read',
  readOnly: true,
  input: z.object({
    org: orgInput,
    campaign: idInput('Campaign id from get_site_overview. Leave out for the whole site.').optional()
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.stats.read', async (tx) => {
    const t = ptTx(tx)
    const site = await ptSite(tx)
    const campaign = input.campaign ? await campaignById(t, input.campaign, { drafts: true }) : null
    if (input.campaign && !campaign) throw createError({ statusCode: 404, statusMessage: 'Campaign not found.' })
    const totals = await statTotals(t, campaign?.id ?? null)
    const stats: Record<string, unknown> = { totals, prayingNow: await prayingNow(t) }
    if (campaign) {
      const n = await tx.selectFrom('pt_commitment').select(eb => eb.fn.countAll<string>().as('n')).where('campaign_id', '=', campaign.id).executeTakeFirst()
      Object.assign(stats, {
        campaign: { id: campaign.id, name: campaign.name, status: campaignStatus(campaign), goal: campaign.goal },
        progress: await goalProgress(t, campaign, site.settings_merged.default_duration_min),
        commitments: Number(n?.n ?? 0)
      })
    }
    return result(campaign ? `Stats for ${campaign.name}.` : 'Site-wide stats.', stats)
  }))
})

function labelIn(t: unknown, lang: string): string {
  return textIn(parseText(t) ?? null, lang)
}

const signupFormTool = defineMcpTool({
  name: 'get_signup_form',
  title: 'Get Signup Form',
  description: 'The extra questions a site asks at signup and its own consent options, with their labels in one language.',
  appId: SITE_APP,
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({ org: orgInput, language: langInput }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.read', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const fields = await tx.selectFrom('pt_signup_field').selectAll().orderBy('position').execute()
    const options = await tx.selectFrom('pt_consent_option').selectAll().orderBy('position').execute()
    return result(`${fields.length} question(s), ${options.length} consent option(s).`, {
      language: lang,
      questions: fields.map(f => ({
        id: f.id,
        key: f.key,
        kind: f.kind,
        label: labelIn(f.label, lang),
        required: f.required,
        options: ((f.options ?? []) as { key: string, label: TranslatableText }[]).map(o => ({ key: o.key, label: textIn(o.label, lang) }))
      })),
      consentOptions: options.map(o => ({ id: o.id, key: o.key, label: labelIn(o.label, lang), active: o.active })),
      adminUrl: adminLink(tenant.orgSlug, '/site/landing/signup-form')
    })
  }))
})

const optionInput = z.object({
  key: z.string().max(40).optional().describe('Stable key; derived from the label when left out.'),
  label: z.string().min(1).max(200)
}).strict()

const addQuestionTool = defineMcpTool({
  name: 'add_signup_question',
  title: 'Add Signup Question',
  description: 'Add a question people answer when they sign up (up to five). The answers are personal data that the site collects, so add one only when the champion asked for it.',
  appId: SITE_APP,
  scope: 'pt.site.write',
  input: z.object({
    org: orgInput,
    kind: z.enum(['text', 'select', 'checkbox']).describe('Short text, dropdown, or checkbox.'),
    label: z.string().min(1).max(200),
    options: z.array(optionInput).max(20).optional().describe('Dropdown choices, at least two.'),
    required: z.boolean().default(false),
    language: langInput
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.write', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const options = (input.options ?? []).map(o => ({
      key: o.key ?? o.label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40),
      label: withText(null, lang, o.label)
    }))
    const { field } = await ptCreateSignupField(tx, tenant, { kind: input.kind, label: withText(null, lang, input.label), options, required: input.required ?? false })
    await audit(ctx, tx, 'CREATE', 'pt_signup_field', field.id, { kind: input.kind })
    return result('Question added.', { id: field.id, key: field.key })
  }))
})

const updateQuestionTool = defineMcpTool({
  name: 'update_signup_question',
  title: 'Update Signup Question',
  description: 'Change a signup question\'s label or dropdown choices in one language, or whether it is required and its position. Its kind and key stay fixed.',
  appId: SITE_APP,
  scope: 'pt.content.translate',
  input: z.object({
    org: orgInput,
    id: idInput('Question id from get_signup_form.'),
    label: z.string().min(1).max(200).optional(),
    options: z.array(optionInput.extend({ key: z.string().max(40) })).max(20).optional().describe('Dropdown choices by key; labels are written in `language`.'),
    required: z.boolean().optional(),
    position: z.number().int().min(0).max(20).optional(),
    language: langInput
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.content.translate', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const field = await tx.selectFrom('pt_signup_field').selectAll().where('id', '=', input.id).executeTakeFirst()
    if (!field) throw createError({ statusCode: 404, statusMessage: 'Question not found.' })
    const b: Record<string, unknown> = {}
    if (input.label !== undefined) b.label = withText(parseText(field.label), lang, input.label)
    if (input.options) {
      const current = (field.options ?? []) as { key: string, label: TranslatableText }[]
      b.options = input.options.map(o => ({ key: o.key, label: withText(current.find(c => c.key === o.key)?.label, lang, o.label) }))
    }
    if (input.required !== undefined) b.required = input.required
    if (input.position !== undefined) b.position = input.position
    await ptUpdateSignupField(tx, tenant, input.id, b)
    await audit(ctx, tx, 'UPDATE', 'pt_signup_field', input.id, { fields: Object.keys(b) })
    return result('Question updated.', { ok: true })
  }))
})

const addConsentTool = defineMcpTool({
  name: 'add_consent_option',
  title: 'Add Consent Option',
  description: 'Add one of the site\'s own consent options (up to five), offered unchecked at signup, e.g. "Send me news about our church\'s mission trips".',
  appId: SITE_APP,
  scope: 'pt.site.write',
  input: z.object({ org: orgInput, label: z.string().min(1).max(300), language: langInput }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.write', async (tx) => {
    const { lang } = await siteLanguage(tx, input.language)
    const { option } = await ptCreateConsentOption(tx, { label: withText(null, lang, input.label) })
    await audit(ctx, tx, 'CREATE', 'pt_consent_option', option.id)
    return result('Consent option added.', { id: option.id, key: option.key })
  }))
})

const updateConsentTool = defineMcpTool({
  name: 'update_consent_option',
  title: 'Update Consent Option',
  description: 'Change a consent option\'s wording in one language, or turn it on or off. People who already agreed keep the wording they saw.',
  appId: SITE_APP,
  scope: 'pt.content.translate',
  input: z.object({
    org: orgInput,
    id: idInput('Consent option id from get_signup_form.'),
    label: z.string().min(1).max(300).optional(),
    active: z.boolean().optional(),
    language: langInput
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.content.translate', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const option = await tx.selectFrom('pt_consent_option').selectAll().where('id', '=', input.id).executeTakeFirst()
    if (!option) throw createError({ statusCode: 404, statusMessage: 'Consent option not found.' })
    const b: Record<string, unknown> = {}
    if (input.label !== undefined) b.label = withText(parseText(option.label), lang, input.label)
    if (input.active !== undefined) b.active = input.active
    await ptUpdateConsentOption(tx, tenant, input.id, b)
    await audit(ctx, tx, 'UPDATE', 'pt_consent_option', input.id, { fields: Object.keys(b) })
    return result('Consent option updated.', { ok: true })
  }))
})

export const siteTools = [
  createSiteTool,
  overviewTool,
  updateSiteTool,
  previewLinkTool,
  statsTool,
  signupFormTool,
  addQuestionTool,
  updateQuestionTool,
  addConsentTool,
  updateConsentTool
]
