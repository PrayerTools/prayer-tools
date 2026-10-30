// Your sites: every site the user belongs to, with role, status, live
// address, current or next campaign and people count, each read inside its
// own org; and the invitations to sites waiting for their email address.
import { requireAuth } from '#core/server/utils/auth'
import { db } from '#core/server/utils/database'
import { getInviteOrgs } from '#core/server/utils/invites'
import { withOrgScope } from '#tenant/server'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { peopleCount } from '@prayertools/shared/stats'
import { siteUrlFor } from '@prayertools/shared/site'
import { loadCampaigns } from '@prayertools/shared/campaigns'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const memberships = await db
    .selectFrom('memberships')
    .innerJoin('orgs', 'orgs.id', 'memberships.org_id')
    .select(['orgs.id', 'orgs.slug', 'orgs.name', 'orgs.suspended_at', 'memberships.roles', 'memberships.created_at'])
    .where('memberships.user_id', '=', user.userId)
    .orderBy('orgs.name')
    .execute()

  const sites = []
  for (const m of memberships) {
    const info = await withOrgScope(m.id, async (scoped) => {
      const tx = ptTx(scoped)
      const site = await tx.selectFrom('pt_site').select(['status', 'onboarding']).executeTakeFirst()
      if (!site) return null
      const campaigns = await loadCampaigns(tx)
      const current = pickCurrentCampaign(campaigns)
      return {
        status: site.status,
        onboarding: site.onboarding,
        url: await siteUrlFor(tx, m.id, m.slug),
        campaign: current ? { id: current.campaign.id, name: current.campaign.name, state: current.state, start_date: current.campaign.start_date } : null,
        people: current ? await peopleCount(tx, current.campaign) : 0
      }
    })
    if (!info) continue
    sites.push({ id: m.id, slug: m.slug, name: m.name, suspended: !!m.suspended_at, roles: m.roles, joined_at: m.created_at, ...info })
  }
  return { sites, invites: await ptPendingInvites(user.userId) }
})

// Unexpired invitations addressed to the user's verified email.
async function ptPendingInvites(userId: string) {
  const me = await db.selectFrom('users').select(['email', 'verified']).where('id', '=', userId).executeTakeFirst()
  if (!me?.verified) return []
  const invites = await db
    .selectFrom('invites')
    .leftJoin('users as inviter', 'inviter.id', 'invites.invited_by')
    .select(['invites.id', 'invites.expires_at', 'inviter.display_name as invited_by'])
    .where(eb => eb(eb.fn('lower', ['invites.email']), '=', me.email.toLowerCase()))
    .where('invites.accepted_at', 'is', null)
    .where('invites.expires_at', '>', new Date())
    .orderBy('invites.created_at', 'desc')
    .execute()
  const orgs = await getInviteOrgs(db, invites.map(i => i.id))
  return invites
    .map(i => ({ id: i.id, expires_at: i.expires_at, invited_by: i.invited_by, sites: (orgs.get(i.id) ?? []).map(o => ({ name: o.name, slug: o.slug, roles: o.roles })) }))
    .filter(i => i.sites.length)
}
