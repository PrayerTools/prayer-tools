// Story form → pt_story with the permissions and the wording version shown,
// an inbox thread for the champion, and an acknowledgement email.
import { withOrg } from '@prayertools/shared/db/scope'
import { CONSENT_WORDING_VERSION, normalizeEmail, upsertContact } from '@prayertools/shared/crm'
import { openInboxThread } from '@prayertools/shared/inbox'
import { bumpStat, recordEvent } from '@prayertools/shared/stats'
import { todayIn } from '@prayertools/shared/dates'
import { acknowledgementEmail } from '@prayertools/shared/email/templates'
import { useDb, ensureSystemUserOnce } from '../utils/db'
import { background, bad, limit, readJson, requireTurnstile, str } from '../utils/request'
import { siteContext } from '../utils/site-context'
import { loadSiteData } from '../utils/site-data'
import { deliver, prepareSiteMail } from '../utils/mail'
import { forwardInBackground } from '../utils/analytics'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  limit(event, 'story', 5, 60_000)
  limit(event, 'story-hour', 20, 3_600_000)
  const body = await readJson(event, 64 * 1024)
  await requireTurnstile(event, body.turnstile)
  const { normalized, valid } = normalizeEmail(str(body.email, 254))
  if (!valid) bad('email')
  const story = str(body.story, 20_000)
  if (!story) bad('story')
  const name = str(body.name, 200) || null
  const mayPublish = body.may_publish === true
  const mayPlatform = body.may_platform === true
  const useName = (mayPublish || mayPlatform) && body.use_name === true && !!name
  await ensureSystemUserOnce()
  const result = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const data = await loadSiteData(tx)
    const lang = data.site.languages.includes(str(body.language, 10)) ? str(body.language, 10) : data.site.default_language
    const wanted = str(body.campaign, 40)
    const campaign = (wanted ? data.campaigns.find(c => c.id === wanted) : null) ?? data.current?.campaign ?? null
    const contact = await upsertContact(tx, { email: normalized, name, source: 'story form' })
    const thread = await openInboxThread(tx, {
      channelId: contact.channelId,
      fromEmail: normalized,
      fromName: name,
      subject: story.split('\n')[0]!.slice(0, 80),
      body: story,
      source: 'story',
      tags: ['story', ...(mayPublish ? ['may_publish'] : []), ...(mayPlatform ? ['may_platform'] : [])]
    })
    await tx.insertInto('pt_story').values({
      campaign_id: campaign?.id ?? null,
      conversation_id: thread.conversationId,
      name,
      body: story,
      language: lang,
      may_publish: mayPublish,
      may_platform: mayPlatform,
      use_name: useName,
      wording_version: CONSENT_WORDING_VERSION
    }).execute()
    await bumpStat(tx, campaign?.id ?? null, todayIn(campaign?.timezone ?? data.site.timezone), 'stories')
    await recordEvent(tx, { campaignId: campaign?.id ?? null, type: 'prayer_story_submitted', meta: { may_publish: mayPublish, may_platform: mayPlatform } })
    const mail = await prepareSiteMail(tx, ctx.orgId, normalized, 'story_ack', m => acknowledgementEmail(m, lang, 'story'))
    return { mail, campaignId: campaign?.id ?? null }
  })
  background(event, deliver(result.mail))
  forwardInBackground(event, { orgId: ctx.orgId, slug: ctx.slug, host: ctx.host }, { event_type: 'prayer_story_submitted', email: normalized, campaignId: result.campaignId })
  return { ok: true }
})
