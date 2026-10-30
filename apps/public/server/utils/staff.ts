// "News from Prayer.Tools" is platform consent, held on a contact in the
// staff org's CRM. The staff org has no pt_site, so it never resolves as a site.
import { withOrg } from '@prayertools/shared/db/scope'
import { PURPOSE_PLATFORM_NEWS, setConsent, upsertContact, type ConsentCapture } from '@prayertools/shared/crm'
import { accountByEmail, linkContactToAccount } from '@prayertools/shared/accounts'
import { useDb } from './db'

export const STAFF_ORG_SLUG = 'staff'
let staffId: string | null = null

export async function staffOrgId(): Promise<string> {
  if (staffId) return staffId
  const db = useDb()
  await db
    .insertInto('orgs')
    .values({ slug: STAFF_ORG_SLUG, name: 'Prayer.Tools', created_at: new Date(), updated_at: new Date() })
    .onConflict(oc => oc.column('slug').doNothing())
    .execute()
  const row = await db.selectFrom('orgs').select('id').where('slug', '=', STAFF_ORG_SLUG).executeTakeFirstOrThrow()
  staffId = row.id
  return row.id
}

// Called once the address is verified, so the contact joins the account.
export async function grantPlatformNews(email: string, name: string | null, capture: Omit<ConsentCapture, 'wording'>): Promise<void> {
  const orgId = await staffOrgId()
  const account = await accountByEmail(useDb(), email)
  await withOrg(useDb(), orgId, async (tx) => {
    const contact = await upsertContact(tx, { email, name, source: 'site signup' })
    await setConsent(tx, contact.channelId, PURPOSE_PLATFORM_NEWS, true, { ...capture, wording: { key: 'consent.platform_news' } })
    if (account?.verified) await linkContactToAccount(tx, contact.contactId, account)
  })
}
