// Download my data across every site.
import { withOrg } from '@prayertools/shared/db/scope'
import { personData } from '@prayertools/shared/subscriptions'
import { useDb } from '../../utils/db'
import { personSubscriptions } from '../../utils/my'
import { requireSessionUser } from '../../utils/account-session'

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUser(event)
  const person = await useDb().selectFrom('users').select(['email', 'display_name', 'created']).where('id', '=', userId).executeTakeFirst()
  const sites = []
  for (const s of await personSubscriptions(userId)) {
    const org = await useDb().selectFrom('orgs').select(['name', 'slug']).where('id', '=', s.org_id).executeTakeFirst()
    sites.push({ site: org?.name ?? null, ...(await withOrg(useDb(), s.org_id, tx => personData(tx, s.id))) })
  }
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'content-disposition', 'attachment; filename="my-prayer-data.json"')
  return JSON.stringify({ email: person?.email ?? null, name: person?.display_name || null, since: person?.created ?? null, sites }, null, 2)
})
