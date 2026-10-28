import { defineTenantHandler } from '#tenant/server'
import { siteUrl, subdomainUrl } from '@prayertools/shared/site'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import { loadCampaigns } from '@prayertools/shared/campaigns'
import { brandColor } from '@prayertools/shared/colors'
import { siteInboxAddress } from '@prayertools/shared/inbox'

export default defineTenantHandler({ appId: 'site' }, async (tx, ctx) => {
  ptNeed(ctx, 'pt.access')
  const site = await ptSite(tx)
  const domains = await tx.selectFrom('pt_site_domain').selectAll().where('org_id', '=', ctx.orgId).orderBy('created_at').execute()
  const active = domains.find(d => d.status === 'active')
  const campaigns = await loadCampaigns(ptTx(tx), { drafts: true })
  const current = pickCurrentCampaign(campaigns)
  const directory = await tx.selectFrom('pt_directory_entry').select(['status', 'requested_at', 'reviewed_at']).where('org_id', '=', ctx.orgId).executeTakeFirst()
  const { preview_token_hash: _hidden, settings_merged, ...rest } = site
  return {
    site: { ...rest, settings: settings_merged, overrides: site.settings },
    org: { id: ctx.orgId, slug: ctx.orgSlug, name: ctx.orgName },
    url: siteUrl(ctx.orgSlug, active?.hostname),
    subdomainUrl: subdomainUrl(ctx.orgSlug),
    brand: brandColor((site.branding as { color?: string })?.color),
    domains,
    directory: directory ?? null,
    inboxAddress: await siteInboxAddress(tx as never, ctx.orgSlug),
    currentCampaign: current ? { ...current.campaign, state: current.state } : null,
    campaignCount: campaigns.length,
    roles: ctx.roles,
    perms: [...ctx.perms].filter(p => p.startsWith('pt.') || p.startsWith('org.') || p.startsWith('crm.') || p.startsWith('inbox.') || p.startsWith('marketing.'))
  }
})
