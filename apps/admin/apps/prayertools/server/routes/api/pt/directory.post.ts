// Opting into the public directory: the site is listed once a Prayer.Tools
// operator approves it. `listed: false` withdraws it.
import { textIn } from '@prayertools/shared/translatable'
import { pgArray } from '@prayertools/shared/db/json'
import type { CampaignBranding, TranslatableText } from '@prayertools/shared/db/schema'
import { pickCurrentCampaign } from '@prayertools/shared/setup'

export default definePtHandler('pt.site.manage', async (event, tx, ctx) => {
  const { listed } = await ptBody<{ listed?: boolean }>(event)
  const site = await ptSite(tx)
  if (!listed) {
    await tx.deleteFrom('pt_directory_entry').where('org_id', '=', ctx.orgId).execute()
    return { status: null }
  }
  if (site.status !== 'published') ptBadRequest('Publish the site before listing it in the directory.')
  const current = pickCurrentCampaign((await tx.selectFrom('pt_campaign').selectAll().execute()).map(ptCampaignOut))?.campaign
  const values = {
    org_id: ctx.orgId,
    slug: ctx.orgSlug,
    name: ctx.orgName,
    description: textIn(site.description as TranslatableText | null, site.default_language).slice(0, 500) || null,
    languages: pgArray(site.languages),
    image_url: (current?.branding as CampaignBranding | undefined)?.image_url ?? null,
    status: 'requested' as const,
    requested_at: new Date(),
    updated_at: new Date()
  }
  await tx.insertInto('pt_directory_entry').values(values as never)
    .onConflict(oc => oc.column('org_id').doUpdateSet({ status: 'requested', requested_at: new Date(), updated_at: new Date() }))
    .execute()
  return { status: 'requested' }
})
