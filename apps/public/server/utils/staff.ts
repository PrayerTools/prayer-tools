// "News from Prayer.Tools" is platform consent, held on a contact in the
// staff org's CRM. The staff org has no pt_site, so it never resolves as a site.
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { normalizeEmail, PURPOSE_PLATFORM_NEWS, setConsent, upsertContact, type ConsentCapture } from '@prayertools/shared/crm'
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

// Staff-org channels with News granted: those of contacts linked to the
// account, and the account's own address.
async function newsChannels(tx: Tx, userId: string, email: string | null): Promise<string[]> {
  const rows = await tx
    .selectFrom('crm_channel_consents as c')
    .innerJoin('crm_channels as ch', 'ch.id', 'c.channel_id')
    .select('c.channel_id')
    .distinct()
    .where('c.purpose', '=', PURPOSE_PLATFORM_NEWS)
    .where('c.status', '=', 'opt_in')
    .where(eb => eb.or([
      eb('c.channel_id', 'in', eb.selectFrom('crm_contact_channels as cc')
        .innerJoin('crm_records as r', 'r.id', 'cc.record_id')
        .select('cc.channel_id')
        .where('r.user_id', '=', userId)),
      ...(email ? [eb('ch.normalized_value', '=', normalizeEmail(email).normalized)] : [])
    ]))
    .execute()
  return rows.map(r => r.channel_id)
}

export async function platformNewsGranted(userId: string, email: string | null): Promise<boolean> {
  return (await withOrg(useDb(), await staffOrgId(), tx => newsChannels(tx, userId, email))).length > 0
}

export async function withdrawPlatformNews(userId: string, email: string | null, capture: Omit<ConsentCapture, 'wording'>): Promise<void> {
  await withOrg(useDb(), await staffOrgId(), async (tx) => {
    for (const id of await newsChannels(tx, userId, email)) await setConsent(tx, id, PURPOSE_PLATFORM_NEWS, false, { ...capture, wording: { key: 'consent.platform_news' } })
  })
}
