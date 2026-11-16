// "Notify me when this campaign runs again": the site-updates consent on a
// CRM contact, without a subscription, and a request for the campaign that
// counts once confirmed from the emailed link. With `account: true` the
// signed-in account's own verified address asks, confirmed at once, with no email.
import { withOrg } from '@prayertools/shared/db/scope'
import { normalizeEmail, PURPOSE_SITE_UPDATES, setConsent, upsertContact } from '@prayertools/shared/crm'
import { notifyConfirmEmail } from '@prayertools/shared/email/templates'
import { notifyOffer, requestNotify, requestNotifyAsAccount } from '@prayertools/shared/notify-requests'
import { useDb, ensureSystemUserOnce } from '../utils/db'
import { deliver, prepareSiteMail } from '../utils/mail'
import { bad, background, clientIp, limit, readJson, requireTurnstile, str } from '../utils/request'
import { siteContext } from '../utils/site-context'
import { loadSiteData } from '../utils/site-data'
import { sessionAccount } from '../utils/account-session'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  limit(event, 'notify', 5, 60_000)
  const body = await readJson(event)
  await requireTurnstile(event, body.turnstile)
  const account = body.account === true ? await sessionAccount(event) : null
  if (body.account === true && !(account?.verified && account.email)) bad('account')
  const { normalized, valid } = normalizeEmail(str(body.email, 254))
  if (!account && !valid) bad('email')
  await ensureSystemUserOnce()
  let already = false
  const mail = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const data = await loadSiteData(tx)
    const wanted = str(body.campaign, 40)
    const campaign = wanted ? data.campaigns.find(c => c.id === wanted || c.slug === wanted) : data.current?.campaign
    if (!campaign) bad('closed')
    const site = data.site
    const lang = site.languages.includes(str(body.language, 10)) ? str(body.language, 10) : site.default_language
    const consent = {
      wording: { key: 'between.notify_title' },
      surface: 'notify_form',
      source: ctx.host,
      language: lang,
      ip: clientIp(event),
      userAgent: getRequestHeader(event, 'user-agent') ?? null
    }
    if (account) {
      const res = await requestNotifyAsAccount(tx, { site, campaign, account, language: lang, consent })
      if (res === 'closed') bad('closed')
      already = res === 'already'
      return null
    }
    if (!(await notifyOffer(tx, data.site, campaign)).form) bad('closed')
    const contact = await upsertContact(tx, { email: normalized, name: str(body.name, 200) || null, data: { pt_language: lang }, source: 'notify form' })
    await setConsent(tx, contact.channelId, PURPOSE_SITE_UPDATES, true, consent)
    const token = await requestNotify(tx, { contactId: contact.contactId, campaignId: campaign.id, language: lang })
    if (!token) return null
    return await prepareSiteMail(tx, ctx.orgId, normalized, 'notify_confirm', m => notifyConfirmEmail(m, lang, { campaignName: campaign.name, confirmUrl: `${m.siteUrl}/notify/${token}` }))
  })
  background(event, deliver(mail))
  return account ? { ok: true, already } : { ok: true }
})
