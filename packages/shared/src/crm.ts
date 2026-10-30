// Writes an intercessor's CRM contact from outside the admin app (public
// signup, the manage page, the worker). Follows the CRM layer's data
// contract: one crm_channels row per address per org, linked to the contact
// through crm_contact_channels; consent is keyed to the channel with an
// append-only event per real change. Every call runs inside the site's org.
import { createHash } from 'node:crypto'
import { sql } from 'kysely'
import type { Db, Tx } from './db/scope'

// Records created without a logged-in user (public signups) are attributed
// to this system account. It has no password, so it can never log in.
export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001'
export const SYSTEM_USER_EMAIL = 'system@prayer.tools.invalid'
export const SYSTEM_ACTOR_LABEL = 'Signup form'

export const CONTACT_EMAIL_FIELD = 'contact_email'

// Consent purposes. Built-in keys live in code; a site's own options use
// `custom:<key>`.
export const PURPOSE_SITE_UPDATES = 'site_updates'
export const PURPOSE_PLATFORM_NEWS = 'platform_news'
export const customPurpose = (key: string) => `custom:${key}`

// Wording shown with each consent box, versioned so the proof log records
// exactly what the person agreed to.
export const CONSENT_WORDING_VERSION = '2026-09'

export async function ensureSystemUser(db: Db | Tx): Promise<void> {
  await db
    .insertInto('users')
    // Verified, so it never reads as an unaccepted invite (no password, not verified).
    .values({ id: SYSTEM_USER_ID, email: SYSTEM_USER_EMAIL, display_name: 'Prayer.Tools system', verified: true, created: new Date(), updated: new Date() })
    .onConflict(oc => oc.column('id').doUpdateSet({ verified: true }))
    .execute()
}

export function normalizeEmail(raw: string): { normalized: string, valid: boolean } {
  let v = raw.trim()
  const angled = v.match(/<([^<>]*)>\s*$/)
  if (angled) v = angled[1]!.trim()
  if (v.toLowerCase().startsWith('mailto:')) v = v.slice(7)
  v = v.toLowerCase()
  return { normalized: v, valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254 }
}

export function channelFingerprint(type: string, normalized: string): string {
  return createHash('sha256').update(`${type}:${normalized}`).digest('hex')
}

export async function claimEmailChannel(tx: Tx, email: string): Promise<{ id: string, verified: boolean, value: string, normalized_value: string }> {
  const { normalized, valid } = normalizeEmail(email)
  if (!valid) throw Object.assign(new Error('Invalid email'), { statusCode: 400 })
  await tx
    .insertInto('crm_channels')
    .values({ channel_type: 'email', value: email.trim(), normalized_value: normalized })
    .onConflict(oc => oc.doNothing())
    .execute()
  return await tx
    .selectFrom('crm_channels')
    .select(['id', 'verified', 'value', 'normalized_value'])
    .where('channel_type', '=', 'email')
    .where('normalized_value', '=', normalized)
    .executeTakeFirstOrThrow()
}

export async function findContactByEmail(tx: Tx, email: string): Promise<{ contactId: string, channelId: string } | null> {
  const { normalized } = normalizeEmail(email)
  const row = await tx
    .selectFrom('crm_channels as ch')
    .innerJoin('crm_contact_channels as cc', 'cc.channel_id', 'ch.id')
    .innerJoin('crm_records as r', 'r.id', 'cc.record_id')
    .select(['r.id as contactId', 'ch.id as channelId'])
    .where('ch.channel_type', '=', 'email')
    .where('ch.normalized_value', '=', normalized)
    .where('r.record_type', '=', 'contacts')
    .orderBy('r.created_at', 'asc')
    .executeTakeFirst()
  return row ?? null
}

async function activity(tx: Tx, recordId: string, action: string, opts: { note?: string, fieldKey?: string, old?: unknown, new?: unknown, label?: string } = {}) {
  await tx
    .insertInto('crm_record_activity')
    .values({
      record_id: recordId,
      actor_user_id: null,
      actor_label: opts.label ?? SYSTEM_ACTOR_LABEL,
      action,
      field_key: opts.fieldKey ?? null,
      old_value: sql`${JSON.stringify(opts.old ?? null)}::text::jsonb`,
      new_value: sql`${JSON.stringify(opts.new ?? null)}::text::jsonb`,
      note: opts.note ?? null
    })
    .execute()
}

export interface UpsertContactInput {
  email: string
  name?: string | null
  data?: Record<string, unknown>
  source?: string
  actorLabel?: string
}

// Creates or reuses the site's contact for an email address. Existing
// contacts keep their name unless it is empty; new custom answers are merged
// into the record's data.
export async function upsertContact(tx: Tx, input: UpsertContactInput): Promise<{ contactId: string, channelId: string, created: boolean, verified: boolean }> {
  const channel = await claimEmailChannel(tx, input.email)
  const existing = await tx
    .selectFrom('crm_contact_channels as cc')
    .innerJoin('crm_records as r', 'r.id', 'cc.record_id')
    .select(['r.id', 'r.name', 'r.data'])
    .where('cc.channel_id', '=', channel.id)
    .where('r.record_type', '=', 'contacts')
    .orderBy('r.created_at', 'asc')
    .executeTakeFirst()
  const name = (input.name ?? '').trim().slice(0, 200)
  if (existing) {
    const data = { ...(existing.data as Record<string, unknown> ?? {}), ...(input.data ?? {}) }
    await tx
      .updateTable('crm_records')
      .set({
        ...(name && !existing.name.trim() ? { name } : {}),
        data: sql`${JSON.stringify(data)}::text::jsonb`,
        updated_at: new Date()
      })
      .where('id', '=', existing.id)
      .execute()
    return { contactId: existing.id, channelId: channel.id, created: false, verified: channel.verified }
  }
  const record = await tx
    .insertInto('crm_records')
    .values({
      record_type: 'contacts',
      name: name || channel.normalized_value.split('@')[0]!,
      status: 'active',
      data: sql`${JSON.stringify(input.data ?? {})}::text::jsonb`,
      created_by: SYSTEM_USER_ID
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  await tx
    .insertInto('crm_contact_channels')
    .values({ record_id: record.id, channel_id: channel.id, field_key: CONTACT_EMAIL_FIELD, is_primary: true, sort_order: 0 })
    .onConflict(oc => oc.doNothing())
    .execute()
  await activity(tx, record.id, 'created', { note: input.source ? `Signed up via ${input.source}` : undefined, label: input.actorLabel })
  await activity(tx, record.id, 'channel_linked', { fieldKey: CONTACT_EMAIL_FIELD, new: { channel_id: channel.id, channel_type: 'email', value: channel.value }, label: input.actorLabel })
  return { contactId: record.id, channelId: channel.id, created: true, verified: channel.verified }
}

export async function markChannelVerified(tx: Tx, channelId: string): Promise<void> {
  await tx
    .updateTable('crm_channels')
    .set({ verified: true, verified_at: new Date(), updated_at: new Date() })
    .where('id', '=', channelId)
    .where('verified', '=', false)
    .execute()
}

export async function primaryEmailOf(tx: Tx, contactId: string): Promise<{ channelId: string, email: string, verified: boolean } | null> {
  const row = await tx
    .selectFrom('crm_contact_channels as cc')
    .innerJoin('crm_channels as ch', 'ch.id', 'cc.channel_id')
    .select(['ch.id as channelId', 'ch.value as email', 'ch.verified as verified'])
    .where('cc.record_id', '=', contactId)
    .where('ch.channel_type', '=', 'email')
    .orderBy('cc.is_primary', 'desc')
    .orderBy('cc.sort_order', 'asc')
    .executeTakeFirst()
  return row ?? null
}

export interface ConsentCapture {
  // The wording shown: an i18n key plus version, or a copy of a custom
  // option's label.
  wording: { key?: string, version?: string, label?: string }
  surface: string
  source: string
  language?: string
  ip?: string | null
  userAgent?: string | null
  actorUserId?: string | null
}

// Grant or withdraw one purpose. Idempotent: re-asserting the current state
// writes no event.
export async function setConsent(tx: Tx, channelId: string, purpose: string, grant: boolean, capture: ConsentCapture): Promise<boolean> {
  const channel = await tx.selectFrom('crm_channels').select(['id', 'channel_type', 'value', 'normalized_value']).where('id', '=', channelId).executeTakeFirst()
  if (!channel) return false
  const status = grant ? 'opt_in' : 'opt_out'
  const existing = await tx.selectFrom('crm_channel_consents').selectAll().where('channel_id', '=', channelId).where('purpose', '=', purpose).executeTakeFirst()
  if (existing?.status === status) return false
  if (!existing && !grant) return false
  const now = new Date()
  const meta = {
    wording_key: capture.wording.key ?? null,
    wording_version: capture.wording.version ?? CONSENT_WORDING_VERSION,
    wording_label: capture.wording.label ?? null,
    surface: capture.surface,
    language: capture.language ?? null
  }
  const values = {
    status,
    granted_at: grant ? now : existing?.granted_at ?? null,
    revoked_at: grant ? existing?.revoked_at ?? null : now,
    source: capture.source,
    capture_meta: sql<Record<string, unknown>>`${JSON.stringify({ ...meta, ...(capture.ip ? { ip: capture.ip } : {}) })}::text::jsonb`
  } as const
  if (existing) {
    await tx.updateTable('crm_channel_consents').set(values).where('id', '=', existing.id).execute()
  } else {
    await tx.insertInto('crm_channel_consents').values({ channel_id: channelId, purpose, ...values }).onConflict(oc => oc.doNothing()).execute()
  }
  await tx
    .insertInto('crm_consent_events')
    .values({
      channel_id: channel.id,
      channel_value: channel.value,
      address_fingerprint: channelFingerprint(channel.channel_type, channel.normalized_value),
      purpose,
      event: grant ? 'grant' : 'revoke',
      source: capture.source,
      actor_user_id: capture.actorUserId ?? null,
      ip: capture.ip ?? null,
      user_agent: capture.userAgent?.slice(0, 500) ?? null,
      meta: sql`${JSON.stringify(meta)}::text::jsonb`
    })
    .execute()
  return true
}

export async function consentState(tx: Tx, channelId: string): Promise<Record<string, boolean>> {
  const rows = await tx.selectFrom('crm_channel_consents').select(['purpose', 'status']).where('channel_id', '=', channelId).execute()
  return Object.fromEntries(rows.map(r => [r.purpose, r.status === 'opt_in']))
}

export async function consentHistory(tx: Tx, channelId: string) {
  return await tx
    .selectFrom('crm_consent_events')
    .select(['purpose', 'event', 'source', 'meta', 'occurred_at'])
    .where('channel_id', '=', channelId)
    .orderBy('occurred_at', 'asc')
    .execute()
}

// An address still linked to another contact, or to an inbox conversation
// (whose foreign key has no cascade), is kept.
export async function deleteChannelIfUnused(tx: Tx, channelId: string): Promise<boolean> {
  const linked = await tx.selectFrom('crm_contact_channels').select('id').where('channel_id', '=', channelId).executeTakeFirst()
  if (linked) return false
  const conversation = await tx.selectFrom('inbox_conversations').select('id').where('channel_id', '=', channelId).executeTakeFirst()
  if (conversation) return false
  await tx.deleteFrom('crm_channels').where('id', '=', channelId).execute()
  return true
}

export const ACCOUNT_ACTOR_LABEL = 'Their account'

export async function setContactName(tx: Tx, contactId: string, name: string): Promise<boolean> {
  const next = name.trim().slice(0, 200)
  const row = await tx.selectFrom('crm_records').select('name').where('id', '=', contactId).executeTakeFirst()
  if (!next || !row || row.name === next) return false
  await tx.updateTable('crm_records').set({ name: next, updated_at: new Date() }).where('id', '=', contactId).execute()
  await activity(tx, contactId, 'field_changed', { fieldKey: 'name', old: row.name, new: next, label: ACCOUNT_ACTOR_LABEL })
  return true
}

// Makes `email` the contact's primary address. Consent given at the old
// address carries over with its original wording; the old address is
// unlinked and removed when nothing else uses it.
export async function replaceContactEmail(tx: Tx, contactId: string, email: string, verified: boolean): Promise<{ channelId: string, changed: boolean }> {
  const current = await primaryEmailOf(tx, contactId)
  const next = await claimEmailChannel(tx, email)
  if (verified) await markChannelVerified(tx, next.id)
  if (current?.channelId === next.id) return { channelId: next.id, changed: false }
  if (current) {
    const granted = await tx
      .selectFrom('crm_channel_consents')
      .select(['purpose', 'capture_meta'])
      .where('channel_id', '=', current.channelId)
      .where('status', '=', 'opt_in')
      .execute()
    for (const c of granted) {
      const meta = (c.capture_meta ?? {}) as { wording_key?: string | null, wording_version?: string | null, wording_label?: string | null, language?: string | null }
      await setConsent(tx, next.id, c.purpose, true, {
        wording: { key: meta.wording_key ?? undefined, version: meta.wording_version ?? undefined, label: meta.wording_label ?? undefined },
        surface: 'account',
        source: 'email_change',
        language: meta.language ?? undefined
      })
    }
    await tx.deleteFrom('crm_contact_channels').where('record_id', '=', contactId).where('channel_id', '=', current.channelId).execute()
    await activity(tx, contactId, 'channel_unlinked', { fieldKey: CONTACT_EMAIL_FIELD, old: { channel_id: current.channelId, channel_type: 'email', value: current.email }, label: ACCOUNT_ACTOR_LABEL })
  }
  await tx
    .insertInto('crm_contact_channels')
    .values({ record_id: contactId, channel_id: next.id, field_key: CONTACT_EMAIL_FIELD, is_primary: true, sort_order: 0 })
    .onConflict(oc => oc.doNothing())
    .execute()
  await activity(tx, contactId, 'channel_linked', { fieldKey: CONTACT_EMAIL_FIELD, new: { channel_id: next.id, channel_type: 'email', value: next.value }, label: ACCOUNT_ACTOR_LABEL })
  if (current) await deleteChannelIfUnused(tx, current.channelId)
  return { channelId: next.id, changed: true }
}
