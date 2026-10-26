// The welcome email, sent once a web signup's email is verified: the person's
// prayer times, their calendar feed and a share link. Runs inside the site's org.
import type { Tx } from '@prayertools/shared/db/scope'
import { primaryEmailOf } from '@prayertools/shared/crm'
import { todayIn } from '@prayertools/shared/dates'
import { prayerTimeLines, welcomeEmail } from '@prayertools/shared/email/templates'
import { manageUrl, personalToken, prayUrl, unsubscribeUrl } from '@prayertools/shared/links'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { normalizeCampaign, type SubscriptionRow } from '@prayertools/shared/subscriptions'
import { prepareSiteMail, type PendingMail } from './mail'

export async function prepareWelcomeMail(tx: Tx, orgId: string, sub: SubscriptionRow): Promise<PendingMail | null> {
  if (sub.delivery !== 'email' || !sub.contact_id) return null
  const email = await primaryEmailOf(tx, sub.contact_id)
  if (!email) return null
  const site = await tx.selectFrom('pt_site').select(['languages', 'default_language']).executeTakeFirstOrThrow()
  const lang = site.languages.includes(sub.language) ? sub.language : site.default_language
  const contact = await tx.selectFrom('crm_records').select('name').where('id', '=', sub.contact_id).executeTakeFirst()
  const commitments = await tx.selectFrom('pt_commitment').selectAll().where('subscription_id', '=', sub.id).orderBy('created_at').execute()
  const campaigns = (await tx.selectFrom('pt_campaign').selectAll().execute()).map(normalizeCampaign)
  const campaign = campaigns.find(c => c.id === commitments.at(-1)?.campaign_id) ?? pickCurrentCampaign(campaigns)?.campaign
  if (!campaign) return null
  const current = pickCurrentCampaign(campaigns)?.campaign.id ?? null
  const startsOn = campaign.start_date && campaign.start_date > todayIn(campaign.timezone) ? campaign.start_date : null
  const times = prayerTimeLines(commitments.filter(c => c.campaign_id === campaign.id), lang)
  const mail = await prepareSiteMail(tx, orgId, email.email, 'welcome', m => welcomeEmail(m, lang, {
    campaignName: campaign.name,
    name: contact?.name || null,
    startsOn,
    times,
    prayUrl: prayUrl(m.siteUrl, campaign.id === current ? null : campaign.slug, null, lang === site.default_language ? null : lang, orgId, sub.id),
    calendarUrl: `${m.siteUrl}/ics/${personalToken(orgId, sub.id)}.ics`,
    shareUrl: sub.referral_code ? `${m.siteUrl}/?r=${encodeURIComponent(sub.referral_code)}` : null,
    manageUrl: manageUrl(m.siteUrl, orgId, sub.id, sub.manage_version),
    unsubscribeUrl: unsubscribeUrl(m.siteUrl, orgId, sub.id)
  }))
  return mail && { ...mail, unsubscribeUrl: unsubscribeUrl(mail.ctx.siteUrl, orgId, sub.id) }
}
