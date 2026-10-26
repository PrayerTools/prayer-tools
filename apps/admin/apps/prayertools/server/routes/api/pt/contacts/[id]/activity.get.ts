// A contact's prayer activity, newest first: emails sent to them (site emails
// from the marketing layer and prayer.tools' own), prayer pages they opened,
// and the times they pressed Amen. Paged with ?offset and ?limit.
import { sql } from 'kysely'

interface ActivityRow {
  type: 'email' | 'opened' | 'prayed'
  kind: string
  subject: string | null
  at: Date
  campaign: string | null
  day: number | null
  seconds: number | null
}

export default definePtHandler('pt.intercessors.read', async (event, tx) => {
  const contactId = getRouterParam(event, 'id')!
  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20))
  const offset = Math.max(0, Number(q.offset) || 0)
  const sub = await tx.selectFrom('pt_subscription').select('id').where('contact_id', '=', contactId).executeTakeFirst()
  const subId = sub?.id ?? null
  const rows = await sql<ActivityRow>`
    SELECT * FROM (
      SELECT 'email' AS type, l.kind, l.subject, l.sent_at AS at, k.name AS campaign, l.day, NULL::int AS seconds
        FROM pt_email_log l LEFT JOIN pt_campaign k ON k.id = l.campaign_id
       WHERE l.subscription_id = ${subId}
      UNION ALL
      SELECT 'email', 'site_email', coalesce(e.versions -> d.language ->> 'subject', e.versions -> e.source_language ->> 'subject'), d.sent_at, NULL, NULL, NULL
        FROM marketing_delivery d JOIN marketing_email e ON e.id = d.email_id
       WHERE d.contact_id = ${contactId} AND d.status = 'sent' AND d.sent_at IS NOT NULL
      UNION ALL
      SELECT 'opened', s.source, NULL, s.started_at, k.name, s.day, s.seconds
        FROM pt_prayer_session s LEFT JOIN pt_campaign k ON k.id = s.campaign_id
       WHERE s.subscription_id = ${subId}
      UNION ALL
      SELECT 'prayed', s.source, NULL, s.last_ping_at, k.name, s.day, s.seconds
        FROM pt_prayer_session s LEFT JOIN pt_campaign k ON k.id = s.campaign_id
       WHERE s.subscription_id = ${subId} AND s.completed
    ) a
    ORDER BY at DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `.execute(tx)
  return { events: rows.rows.slice(0, limit), more: rows.rows.length > limit }
})
