// The contact form's extra questions and notification recipients, with the
// members who can be notified (those who can open the inbox).
import type { SiteContactForm } from '@prayertools/shared/db/schema'

export default definePtHandler('pt.site.read', async (_event, tx, ctx) => {
  const site = await ptSite(tx)
  return { form: site.contact_form as SiteContactForm, members: await ptInboxMembers(tx, ctx.orgId) }
})
