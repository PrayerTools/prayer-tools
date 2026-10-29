// What this browser's sign-in and manage cookie say about the visitor on this
// site (share link code, signup and story form prefill). Private; never cached.
import { withOrg } from '@prayertools/shared/db/scope'
import { primaryEmailOf } from '@prayertools/shared/crm'
import { useDb } from '../utils/db'
import { siteContext } from '../utils/site-context'
import { managedSubscription } from '../utils/manage'
import { readManageCookie } from '../utils/cookies'
import { sessionAccount } from '../utils/account-session'

export default defineEventHandler(async (event) => {
  const ctx = siteContext(event)
  const account = await sessionAccount(event)
  const signedIn = account?.email ? { email: account.email, name: account.display_name || null } : null
  if (!account && !readManageCookie(event, ctx.orgId)) return { referral_code: null, email: null, name: null, account: null, subscribed: false }
  return await withOrg(useDb(), ctx.orgId, async (tx) => {
    const sub = await managedSubscription(tx, event, ctx.orgId)
    if (!sub) return { referral_code: null, email: signedIn?.email ?? null, name: signedIn?.name ?? null, account: signedIn, subscribed: false }
    const email = sub.contact_id ? await primaryEmailOf(tx, sub.contact_id) : null
    const contact = sub.contact_id ? await tx.selectFrom('crm_records').select('name').where('id', '=', sub.contact_id).executeTakeFirst() : null
    return { referral_code: sub.referral_code, email: email?.email ?? null, name: contact?.name ?? null, account: signedIn, subscribed: true }
  })
})
