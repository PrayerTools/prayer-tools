// A site's former hostname (`pt_site_alias`, such as a WordPress-era
// `yemen.pray4movement.org`) → the site's address, so old links redirect to
// the same path there.
import { withOrg } from '@prayertools/shared/db/scope'
import { siteUrlFor } from '@prayertools/shared/site'
import { useDb } from './db'

export async function siteAliasTarget(hostname: string): Promise<string | null> {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '')
  const row = await useDb()
    .selectFrom('pt_site_alias')
    .innerJoin('orgs', 'orgs.id', 'pt_site_alias.org_id')
    .select(['orgs.id as id', 'orgs.slug as slug', 'orgs.suspended_at as suspended_at'])
    .where('pt_site_alias.hostname', '=', host)
    .executeTakeFirst()
  if (!row || row.suspended_at) return null
  return await withOrg(useDb(), row.id, async (tx) => {
    const site = await tx.selectFrom('pt_site').select('status').executeTakeFirst()
    if (!site || site.status === 'draft') return null
    return await siteUrlFor(tx, row.id, row.slug)
  })
}
