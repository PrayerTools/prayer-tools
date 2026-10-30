// Joins the site in the app (or updates language / timezone). App
// subscriptions point at the device's account and never get email reminders.
import { withOrg } from '@prayertools/shared/db/scope'
import { isValidTimezone } from '@prayertools/shared/dates'
import { recordActivity, refreshReminders } from '@prayertools/shared/subscriptions'
import { useDb } from '../../../../utils/db'
import { readJson, str } from '../../../../utils/request'
import { apiSite, ensureAppSubscription, requireDevice } from '../../../../utils/app-api'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  const site = await apiSite(getRouterParam(event, 'slug'))
  const body = await readJson(event, 4096)
  const tz = str(body.timezone, 64)
  if (tz && !isValidTimezone(tz)) throw createError({ statusCode: 400, statusMessage: 'timezone' })
  return await withOrg(useDb(), site.orgId, async (tx) => {
    const languages = (await tx.selectFrom('pt_site').select('languages').executeTakeFirstOrThrow()).languages
    const lang = str(body.language, 10)
    let sub = await ensureAppSubscription(tx, device.userId, { language: lang, timezone: tz || null, referral: str(body.referral, 20) || null })
    const patch: { language?: string, timezone?: string, updated_at: Date } = { updated_at: new Date() }
    if (lang && languages.includes(lang)) patch.language = lang
    if (tz) patch.timezone = tz
    sub = await tx.updateTable('pt_subscription').set(patch).where('id', '=', sub.id).returningAll().executeTakeFirstOrThrow()
    if (sub.status === 'unsubscribed' && body.resubscribe === true) {
      await tx.updateTable('pt_subscription').set({ status: 'active', unsubscribed_at: null, updated_at: new Date() }).where('id', '=', sub.id).execute()
      await refreshReminders(tx, sub.id)
    } else {
      await recordActivity(tx, sub.id)
    }
    const fresh = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', sub.id).executeTakeFirstOrThrow()
    return { id: fresh.id, status: fresh.status, language: fresh.language, timezone: fresh.timezone, referral_code: fresh.referral_code }
  })
})
