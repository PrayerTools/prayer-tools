// "Ask Prayer.Tools for help": a site team member sends one inbox
// conversation to the platform operators, who read it through support access
// and answer the person who asked. The person who wrote in is never
// contacted, and the conversation's status, assignment and messages stay as
// they are. Runs inside the site's org.
import type { Tx } from './db/scope'
import { enqueue } from './jobs'

export const HELP_NOTE_MAX = 1000
export const HELP_REPLY_MAX = 2000
// Anyone on the site's team who can reply in the inbox can ask.
export const HELP_REQUEST_PERMISSION = 'inbox.send'

export class HelpRequestError extends Error {
  constructor(readonly statusCode: 400 | 403 | 404 | 409, message: string) {
    super(message)
    this.name = 'HelpRequestError'
  }
}

// Writes an event on the conversation's "Notes & activity" timeline; in the
// admin app, the inbox layer's `inboxLogConversationEvent`.
export type ConversationEventLogger = (tx: Tx, conversationId: string, eventType: string, message: string, opts: { userId?: string }) => Promise<void>

export interface OpenHelpRequest {
  id: string
  note: string
  created_at: Date
  requested_by_name: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function openHelpRequest(tx: Tx, conversationId: string): Promise<OpenHelpRequest | null> {
  if (!UUID.test(conversationId)) return null
  const row = await tx.selectFrom('pt_help_request as h').leftJoin('users as u', 'u.id', 'h.requested_by')
    .select(['h.id', 'h.note', 'h.created_at', 'u.display_name', 'u.email'])
    .where('h.conversation_id', '=', conversationId).where('h.handled_at', 'is', null).executeTakeFirst()
  return row ? { id: row.id, note: row.note, created_at: row.created_at, requested_by_name: row.display_name || row.email } : null
}

function text(value: unknown, max: number, field: string): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  if (s.length > max) throw new HelpRequestError(400, `The ${field} can be at most ${max} characters.`)
  return s || null
}

async function userName(tx: Tx, userId: string): Promise<string> {
  const u = await tx.selectFrom('users').select(['display_name', 'email']).where('id', '=', userId).executeTakeFirst()
  return u?.display_name || u?.email || 'a team member'
}

export interface AskForHelpInput {
  orgId: string
  userId: string
  perms: ReadonlySet<string>
  conversationId: string
  note: unknown
}

// Records the request, logs it on the conversation and queues the operators' email.
export async function askForHelp(tx: Tx, input: AskForHelpInput, log: ConversationEventLogger): Promise<{ id: string }> {
  if (!input.perms.has(HELP_REQUEST_PERMISSION)) throw new HelpRequestError(403, `Permission required: ${HELP_REQUEST_PERMISSION}`)
  const note = text(input.note, HELP_NOTE_MAX, 'note')
  if (!note) throw new HelpRequestError(400, 'Say what you need help with.')
  const conversation = UUID.test(input.conversationId)
    ? await tx.selectFrom('inbox_conversations').select('id').where('id', '=', input.conversationId).executeTakeFirst()
    : undefined
  if (!conversation) throw new HelpRequestError(404, 'Conversation not found.')
  const row = await tx.insertInto('pt_help_request')
    .values({ conversation_id: conversation.id, requested_by: input.userId, note })
    .onConflict(oc => oc.column('conversation_id').where('handled_at', 'is', null).doNothing())
    .returning('id').executeTakeFirst()
  if (!row) throw new HelpRequestError(409, 'This conversation was already sent to Prayer.Tools.')
  await log(tx, conversation.id, 'pt_help_requested', `Sent to Prayer.Tools by ${await userName(tx, input.userId)}: ${note}`, { userId: input.userId })
  await enqueue(tx, 'help_request_alert', { requestId: row.id }, { orgId: input.orgId, referenceType: 'pt_help_request', referenceId: row.id })
  return { id: row.id }
}

export interface HandleHelpRequestInput {
  orgId: string
  requestId: string
  operatorId: string
  reply: unknown
}

// Marks the request handled, logs the operator's reply on the conversation and
// notifies the team member who asked, while they are still on the site's team.
export async function handleHelpRequest(tx: Tx, input: HandleHelpRequestInput, log: ConversationEventLogger): Promise<void> {
  const reply = text(input.reply, HELP_REPLY_MAX, 'reply')
  const row = await tx.updateTable('pt_help_request')
    .set({ handled_at: new Date(), handled_by: input.operatorId, reply })
    .where('id', '=', input.requestId).where('handled_at', 'is', null)
    .returning(['id', 'conversation_id', 'requested_by', 'note']).executeTakeFirst()
  if (!row) {
    const exists = await tx.selectFrom('pt_help_request').select('id').where('id', '=', input.requestId).executeTakeFirst()
    throw exists ? new HelpRequestError(409, 'This request was already handled.') : new HelpRequestError(404, 'Help request not found.')
  }
  await log(tx, row.conversation_id, 'pt_help_handled', reply ? `Prayer.Tools: ${reply}` : 'Prayer.Tools marked the help request handled.', { userId: input.operatorId })
  if (!row.requested_by || row.requested_by === input.operatorId) return
  const member = await tx.selectFrom('memberships').select('user_id')
    .where('user_id', '=', row.requested_by).where('org_id', '=', input.orgId).executeTakeFirst()
  if (!member) return
  await tx.insertInto('notifications').values({
    user_id: row.requested_by,
    app_id: 'inbox',
    title: reply ? 'Prayer.Tools answered your help request' : 'Prayer.Tools handled your help request',
    body: reply ?? `Your request: ${row.note}`,
    icon: 'i-lucide-life-buoy',
    // The query keeps the inbox's team-wide "seen" clear (exact `/inbox/<id>` links) off this notice.
    link: `/inbox/${row.conversation_id}?help=${row.id}`,
    actor_id: input.operatorId,
    email_mode: 'immediate'
  }).execute()
}
