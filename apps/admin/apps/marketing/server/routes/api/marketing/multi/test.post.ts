import { renderEmail } from '../../../../../lib/render'
import { signToken, unsubscribeUrls } from '../../../../../lib/tokens'

// "Send me a test" as one of the chosen sites.
export default defineMarketingUserHandler(async (event, _tx, userId) => {
  const b = await marketingBody(event)
  const [site] = await marketingRequireSites(userId, [b.org_id])
  const host = marketingHost()
  const input = marketingDraftInput(b, Object.keys((b.versions ?? {}) as object).concat(String(b.source_language ?? '')))
  const lang = typeof b.lang === 'string' ? b.lang : input.sourceLanguage
  const user = await marketingUserEmail(userId)
  const urls = unsubscribeUrls(host.unsubscribeBaseUrl(), signToken({ o: site!.id, t: true }, host.secret()))
  const firstName = user.name.trim().split(/\s+/)[0] || ''
  await marketingInOrg(site!.id, async (tx) => {
    const rendered = await renderEmail(host, tx, site!.id, { versions: input.versions, source_language: input.sourceLanguage }, lang,
      { contactId: null, channelId: null, address: user.email, language: lang, firstName }, { unsubscribeUrl: urls.page, test: true })
    const sender = await host.sender(tx, site!.id)
    const sent = await host.send({
      to: user.email,
      fromName: sender.fromName,
      fromLocal: sender.fromLocal,
      replyTo: sender.replyTo,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: null,
      orgId: site!.id
    })
    if (sent.status === 'suppressed') throw createError({ statusCode: 422, statusMessage: 'Your address is on the suppression list after a bounce or spam report, so the test wasn\'t sent. A host admin can clear it under Admin → Email → Suppressions.' })
  })
  return { to: user.email }
})
