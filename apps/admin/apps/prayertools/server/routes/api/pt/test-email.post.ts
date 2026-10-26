// "Send me a test email": any email the site sends, in any site language, to
// the signed-in team member. Test emails never contain live personal links.
import { db } from '#core/server/utils/database'
import { sendMail } from '@prayertools/shared/email/transport'
import { acknowledgementEmail, checkinEmail, loadSiteMailContext, manageLinkEmail, prayerTimeLines, reminderEmail, thankYouEmail, verificationEmail, welcomeEmail } from '@prayertools/shared/email/templates'
import { textIn } from '@prayertools/shared/translatable'
import { durationRule } from '@prayertools/shared/setup'
import type { CampaignCta, TranslatableText } from '@prayertools/shared/db/schema'

export default definePtHandler('pt.email.send', async (event, tx, ctx) => {
  const b = await ptBody<{ kind?: string, language?: string, campaignId?: string }>(event)
  const site = await ptSite(tx)
  const lang = site.languages.includes(String(b.language)) ? String(b.language) : site.default_language
  const user = await db.selectFrom('users').select(['email']).where('id', '=', ctx.userId).executeTakeFirstOrThrow()
  const mail = await loadSiteMailContext(ptTx(tx), ctx.orgId)
  const dead = `${mail.siteUrl}/#test-email`
  const campaignRow = b.campaignId
    ? await tx.selectFrom('pt_campaign').selectAll().where('id', '=', b.campaignId).executeTakeFirst()
    : await tx.selectFrom('pt_campaign').selectAll().orderBy('start_date', 'desc').executeTakeFirst()
  const campaignName = campaignRow?.name ?? ctx.orgName
  const opts = { test: true }
  let rendered
  switch (b.kind) {
    case 'verification': rendered = verificationEmail(mail, lang, dead, opts); break
    case 'welcome': {
      const minutes = campaignRow && durationRule(campaignRow.goal, campaignRow.track_time) === 'hidden' ? null : site.settings_merged.default_duration_min
      const times = prayerTimeLines([{ kind: 'recurring', frequency: 'daily', days_of_week: [], time: '07:00', timezone: campaignRow?.timezone ?? 'UTC', duration_min: minutes, dates: [] }], lang)
      rendered = welcomeEmail(mail, lang, { campaignName, name: null, startsOn: null, times, prayUrl: dead, calendarUrl: dead, shareUrl: dead, manageUrl: dead, unsubscribeUrl: dead }, opts)
      break
    }
    case 'reminder': rendered = reminderEmail(mail, lang, { campaignName, day: 3, minutes: site.settings_merged.default_duration_min, prayUrl: dead, manageUrl: dead, unsubscribeUrl: dead }, opts); break
    case 'checkin': rendered = checkinEmail(mail, lang, { yes: dead, sometimes: dead, no: dead, manageUrl: dead, unsubscribeUrl: dead }, opts); break
    case 'thanks': {
      const cta = (campaignRow?.cta ?? {}) as CampaignCta
      rendered = thankYouEmail(mail, lang, {
        campaignName,
        personal: campaignRow?.start_mode === 'join',
        prayers: 12,
        minutes: 180,
        message: textIn(campaignRow?.end_message as TranslatableText | null, lang, site.default_language) || null,
        cta: cta.url && cta.label ? { label: textIn(cta.label, lang, site.default_language), url: cta.url } : null,
        manageUrl: dead,
        unsubscribeUrl: dead
      }, opts)
      break
    }
    case 'manage': rendered = manageLinkEmail(mail, lang, dead); break
    case 'contact': rendered = acknowledgementEmail(mail, lang, 'contact'); break
    case 'story': rendered = acknowledgementEmail(mail, lang, 'story'); break
    default: ptBadRequest('Unknown email.')
  }
  await sendMail({
    stream: 'transactional',
    to: user.email,
    fromName: mail.fromName,
    fromLocal: mail.fromLocal,
    replyTo: mail.replyTo,
    subject: `[Test] ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
    meta: { org_id: ctx.orgId, kind: 'test' }
  })
  return { sentTo: user.email }
})
