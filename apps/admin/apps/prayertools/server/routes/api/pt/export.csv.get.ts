// CSV of the site's intercessors, downloaded straight away and logged.
// Unsubscribed people appear without name or email; anonymous app
// intercessors aren't included.
import { sql } from 'kysely'
import { textIn } from '@prayertools/shared/translatable'
import type { TranslatableText } from '@prayertools/shared/db/schema'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export default definePtHandler('pt.intercessors.export', async (event, tx, ctx) => {
  const site = await ptSite(tx)
  const fields = await tx.selectFrom('pt_signup_field').select(['key', 'label']).orderBy('position').execute()
  const options = await tx.selectFrom('pt_consent_option').select(['key']).orderBy('position').execute()
  const rows = await tx.selectFrom('pt_subscription as s')
    .innerJoin('records_entries as r', 'r.id', 's.contact_id')
    .select([
      's.id', 's.status', 's.language', 's.timezone', 's.created_at', 's.verified_at', 'r.name', 'r.data',
      sql<string | null>`(select ch.value from crm_contact_channels cc join crm_channels ch on ch.id = cc.channel_id where cc.record_id = r.id and ch.channel_type = 'email' order by cc.is_primary desc limit 1)`.as('email'),
      sql<string | null>`(select ch.id::text from crm_contact_channels cc join crm_channels ch on ch.id = cc.channel_id where cc.record_id = r.id and ch.channel_type = 'email' order by cc.is_primary desc limit 1)`.as('channel_id')
    ])
    .where('s.anonymized_at', 'is', null)
    .orderBy('s.created_at')
    .execute()
  const commitments = await tx.selectFrom('pt_commitment').select(['subscription_id', 'kind', 'frequency', 'days_of_week', 'time', 'duration_min', 'dates']).execute()
  const bySub = new Map<string, string[]>()
  for (const c of commitments) {
    const label = c.kind === 'dates'
      ? `${c.dates.length} date(s) at ${c.time}`
      : `${c.frequency === 'daily' ? 'Daily' : c.days_of_week.map(d => DAYS[d]).join('/')} ${c.time}${c.duration_min ? ` (${c.duration_min} min)` : ''}`
    bySub.set(c.subscription_id, [...(bySub.get(c.subscription_id) ?? []), label])
  }
  const consents = await tx.selectFrom('crm_channel_consents').select(['channel_id', 'purpose', 'status']).execute()
  const consentBy = new Map<string, Map<string, string>>()
  for (const c of consents) {
    if (!consentBy.has(c.channel_id)) consentBy.set(c.channel_id, new Map())
    consentBy.get(c.channel_id)!.set(c.purpose, c.status === 'opt_in' ? 'yes' : 'no')
  }
  const header = ['Name', 'Email', 'Language', 'Timezone', 'Signed up', 'Verified', 'Status', 'Reminder times', ...fields.map(f => textIn(f.label as TranslatableText, site.default_language)), 'Updates from this site', ...options.map(o => `Consent: ${o.key}`)]
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) {
    const hidden = r.status === 'unsubscribed'
    const data = (r.data ?? {}) as Record<string, unknown>
    const consent = r.channel_id ? consentBy.get(r.channel_id) : undefined
    lines.push([
      hidden ? '' : r.name,
      hidden ? '' : r.email,
      r.language,
      r.timezone,
      new Date(r.created_at).toISOString().slice(0, 10),
      r.verified_at ? 'yes' : 'no',
      r.status,
      (bySub.get(r.id) ?? []).join('; '),
      ...fields.map(f => hidden ? '' : data[`pt_${f.key}`]),
      consent?.get('site_updates') ?? '',
      ...options.map(o => consent?.get(`custom:${o.key}`) ?? '')
    ].map(csvCell).join(','))
  }
  await tx.insertInto('pt_export_log').values({ user_id: ctx.userId, row_count: rows.length }).execute()
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${ctx.orgSlug}-intercessors-${new Date().toISOString().slice(0, 10)}.csv"`)
  return '﻿' + lines.join('\r\n')
})
