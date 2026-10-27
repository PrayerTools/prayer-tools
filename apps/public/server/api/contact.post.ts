// Contact form → a thread in the champion's inbox plus a staff notification,
// with an acknowledgement email when the site has it on.
import { withOrg } from '@prayertools/shared/db/scope'
import { normalizeEmail, upsertContact } from '@prayertools/shared/crm'
import { notifyInboxThread, openInboxThread } from '@prayertools/shared/inbox'
import { siteSettings } from '@prayertools/shared/site'
import { textIn } from '@prayertools/shared/translatable'
import type { SiteContactForm } from '@prayertools/shared/db/schema'
import { acknowledgementEmail } from '@prayertools/shared/email/templates'
import { useDb, ensureSystemUserOnce } from '../utils/db'
import { background, bad, limit, readJson, requireTurnstile, str } from '../utils/request'
import { siteContext } from '../utils/site-context'
import { deliver, prepareSiteMail } from '../utils/mail'
import { parseAnswers } from '../lib/input'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  limit(event, 'contact', 5, 60_000)
  limit(event, 'contact-hour', 30, 3_600_000)
  const body = await readJson(event)
  await requireTurnstile(event, body.turnstile)
  const { normalized, valid } = normalizeEmail(str(body.email, 254))
  if (!valid) bad('email')
  const message = str(body.message, 10_000)
  if (!message) bad('message')
  const name = str(body.name, 200) || null
  await ensureSystemUserOnce()
  const mail = await withOrg(useDb(), ctx.orgId, async (tx) => {
    const site = await tx.selectFrom('pt_site').select(['settings', 'languages', 'default_language', 'contact_form']).executeTakeFirstOrThrow()
    const lang = site.languages.includes(str(body.language, 10)) ? str(body.language, 10) : site.default_language
    const form = site.contact_form as SiteContactForm
    const fields = form.fields ?? []
    const { answers, missing } = parseAnswers(fields, body.answers)
    if (missing.length) bad('required_field')
    // Answers follow the message as "Question: answer" lines in the site's default language.
    const def = site.default_language
    const answerLines = fields.filter(f => `pt_${f.key}` in answers).map((f) => {
      const v = answers[`pt_${f.key}`]
      const shown = f.kind === 'select' ? textIn(f.options.find(o => o.key === v)?.label, def) : f.kind === 'checkbox' ? 'Yes' : String(v)
      return `${textIn(f.label, def)}: ${shown}`
    })
    const contact = await upsertContact(tx, { email: normalized, name, source: 'contact form' })
    const firstLine = message.split('\n')[0]!.slice(0, 80)
    const thread = await openInboxThread(tx, { channelId: contact.channelId, fromEmail: normalized, fromName: name, subject: firstLine, body: answerLines.length ? `${message}\n\n${answerLines.join('\n')}` : message, source: 'contact_form', tags: ['contact'] })
    await notifyInboxThread(tx, ctx.orgId, { conversationId: thread.conversationId, fromEmail: normalized, fromName: name, subject: firstLine, body: message, userIds: form.notify_user_ids })
    if (!siteSettings(site.settings).auto_ack_contact) return null
    return await prepareSiteMail(tx, ctx.orgId, normalized, 'contact_ack', m => acknowledgementEmail(m, lang, 'contact'))
  })
  background(event, deliver(mail))
  return { ok: true }
})
