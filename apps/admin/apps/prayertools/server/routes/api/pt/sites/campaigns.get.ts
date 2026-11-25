// For the search box: every site the user can open and the campaigns of
// those where they can see campaigns, drafts included, each site read
// inside its own org.
import { requireAuth } from '#core/server/utils/auth'
import { listUserOrgs, withOrgScope } from '#tenant/server'
import { normalizeCampaign } from '@prayertools/shared/campaigns'
import { campaignStatus } from '@prayertools/shared/setup'
import { siteUrlFor } from '@prayertools/shared/site'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const orgs = await listUserOrgs(user.userId, { appId: 'site', permission: 'pt.access' as never })
  const sites = []
  const campaigns = []
  for (const org of orgs) {
    const found = await withOrgScope(org.id, async (scoped) => {
      const tx = ptTx(scoped)
      const site = await tx.selectFrom('pt_site').select('status').executeTakeFirst()
      if (!site) return null
      const rows = org.perms.has('pt.site.read')
        ? (await tx.selectFrom('pt_campaign').selectAll().orderBy('start_date', 'desc').orderBy('created_at', 'desc').execute()).map(normalizeCampaign)
        : []
      return { status: site.status, url: await siteUrlFor(tx, org.id, org.slug), rows }
    })
    if (!found) continue
    sites.push({ slug: org.slug, name: org.name, status: found.status, url: found.url })
    for (const c of found.rows) {
      campaigns.push({
        id: c.id,
        name: c.name,
        siteSlug: org.slug,
        siteName: org.name,
        draft: !c.published_at,
        status: campaignStatus(c),
        start_mode: c.start_mode,
        start_date: c.start_date,
        end_mode: c.end_mode,
        end_date: c.end_date,
        length_days: c.length_days,
        goal: c.goal,
        cadence: c.cadence,
        ended_at: c.ended_at,
        timezone: c.timezone
      })
    }
  }
  return { sites, campaigns }
})
