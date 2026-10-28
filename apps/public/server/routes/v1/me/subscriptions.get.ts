// The device person's subscriptions across sites, with each campaign's
// status so the app can stop reminders for ended campaigns or inactive
// subscriptions. Listed in person scope; site details read per org.
import { withOrg, withPerson } from '@prayertools/shared/db/scope'
import { siteSettings } from '@prayertools/shared/site'
import { useDb } from '../../../utils/db'
import { loadCampaigns } from '@prayertools/shared/campaigns'
import { campaignJson, commitmentJson, requireDevice } from '../../../utils/app-api'

export default defineEventHandler(async (event) => {
  const device = await requireDevice(event)
  const subs = await withPerson(useDb(), device.userId, tx => tx
    .selectFrom('pt_subscription')
    .select(['id', 'org_id'])
    .where('user_id', '=', device.userId)
    .where('delivery', '=', 'app')
    .execute())
  const out = []
  for (const s of subs) {
    const org = await useDb().selectFrom('orgs').select(['slug', 'name', 'suspended_at']).where('id', '=', s.org_id).executeTakeFirst()
    if (!org || org.suspended_at) continue
    out.push(await withOrg(useDb(), s.org_id, async (tx) => {
      const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', s.id).executeTakeFirstOrThrow()
      const site = await tx.selectFrom('pt_site').select(['status', 'settings']).executeTakeFirstOrThrow()
      const campaigns = await loadCampaigns(tx)
      const commitments = await tx.selectFrom('pt_commitment').selectAll().where('subscription_id', '=', sub.id).execute()
      const defaults = siteSettings(site.settings).default_duration_min
      const used = new Set(commitments.map(c => c.campaign_id))
      return {
        site: { slug: org.slug, name: org.name, status: site.status },
        subscription: { id: sub.id, status: sub.status, language: sub.language, timezone: sub.timezone, referral_code: sub.referral_code },
        reminders: sub.status === 'active' && site.status === 'published',
        campaigns: campaigns.filter(c => used.has(c.id)).map(c => ({
          ...campaignJson(c, defaults),
          commitments: commitments.filter(x => x.campaign_id === c.id).map(commitmentJson)
        }))
      }
    }))
  }
  return { subscriptions: out }
})
