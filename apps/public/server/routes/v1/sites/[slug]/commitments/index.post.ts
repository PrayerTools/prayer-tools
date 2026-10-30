// A prayer time in a campaign, sent by the app as its own rule. App
// commitments never get `next_reminder_utc` (the app schedules locally).
import { withOrg } from '@prayertools/shared/db/scope'
import { insertCommitment, validateRuleForCampaign } from '@prayertools/shared/subscriptions'
import { campaignStatus, defaultDuration, pickCurrentCampaign } from '@prayertools/shared/setup'
import { isValidTimezone } from '@prayertools/shared/dates'
import { siteSettings } from '@prayertools/shared/site'
import { useDb } from '../../../../../utils/db'
import { readJson } from '../../../../../utils/request'
import { loadCampaigns } from '@prayertools/shared/campaigns'
import { apiSite, commitmentJson, ensureAppSubscription, requireDevice } from '../../../../../utils/app-api'
import { parseRuleInput } from '../../../../../lib/input'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  const site = await apiSite(getRouterParam(event, 'slug'))
  const body = await readJson(event, 16_384)
  const rule = parseRuleInput(body)
  if (!rule) throw createError({ statusCode: 400, statusMessage: 'commitment' })
  if (rule.timezone && !isValidTimezone(rule.timezone)) throw createError({ statusCode: 400, statusMessage: 'timezone' })
  const row = await withOrg(useDb(), site.orgId, async (tx) => {
    const campaigns = await loadCampaigns(tx)
    const wanted = typeof body.campaign === 'string' ? body.campaign : null
    const campaign = wanted ? campaigns.find(c => c.id === wanted || c.slug === wanted) : pickCurrentCampaign(campaigns)?.campaign
    if (!campaign || campaignStatus(campaign) === 'ended') throw createError({ statusCode: 409, statusMessage: 'Campaign is not open' })
    const settings = siteSettings((await tx.selectFrom('pt_site').select('settings').executeTakeFirstOrThrow()).settings)
    if (rule.duration_min === null && campaign.goal !== 'people') rule.duration_min = defaultDuration(campaign, settings.default_duration_min)
    const errors = validateRuleForCampaign(rule, campaign)
    if (errors.length) throw createError({ statusCode: 400, statusMessage: 'commitment', data: { errors } })
    const sub = await ensureAppSubscription(tx, device.intercessorId, { timezone: rule.timezone ?? null, language: typeof body.language === 'string' ? body.language : null })
    if (sub.status === 'unsubscribed') throw createError({ statusCode: 409, statusMessage: 'Unsubscribed' })
    return await insertCommitment(tx, sub, campaign, rule)
  })
  setResponseStatus(event, 201)
  return commitmentJson(row)
})
