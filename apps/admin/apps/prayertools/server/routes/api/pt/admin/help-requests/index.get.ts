// Help requests from every site, open first, newest first.
import { sql } from 'kysely'
import { requireOperatorAdmin } from '#tenant/server'
import { HELP_REPLY_MAX } from '@prayertools/shared/help-requests'

export default defineEventHandler(async (event) => {
  await requireOperatorAdmin(event)
  const requests = await ptAdminDb().selectFrom('pt_help_request as h')
    .innerJoin('orgs as o', 'o.id', 'h.org_id')
    .leftJoin('inbox_conversations as c', 'c.id', 'h.conversation_id')
    .leftJoin('users as u', 'u.id', 'h.requested_by')
    .leftJoin('users as hu', 'hu.id', 'h.handled_by')
    .select([
      'h.id', 'h.org_id', 'h.conversation_id', 'h.note', 'h.created_at', 'h.handled_at', 'h.reply',
      'o.name as site_name', 'o.slug as site_slug', 'c.subject',
      sql<string | null>`coalesce(nullif(u.display_name, ''), u.email)`.as('asked_by'),
      sql<string | null>`coalesce(nullif(hu.display_name, ''), hu.email)`.as('handled_by')
    ])
    .orderBy(sql`h.handled_at is not null`).orderBy('h.created_at', 'desc').limit(300).execute()
  return { requests, replyMax: HELP_REPLY_MAX }
})
