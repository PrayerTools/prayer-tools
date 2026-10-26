// Records site emails sent to a subscriber, for their activity on the
// contact record. Written after a successful send.
import type { Tx } from '../db/scope'

export interface EmailLogEntry {
  subscriptionId: string
  kind: string
  subject: string
  campaignId?: string | null
  day?: number | null
  sentAt?: Date
}

export async function logEmails(tx: Tx, entries: EmailLogEntry[]): Promise<void> {
  if (entries.length === 0) return
  await tx
    .insertInto('pt_email_log')
    .values(entries.map(e => ({
      subscription_id: e.subscriptionId,
      kind: e.kind,
      subject: e.subject.slice(0, 500),
      campaign_id: e.campaignId ?? null,
      day: e.day ?? null,
      ...(e.sentAt ? { sent_at: e.sentAt } : {})
    })))
    .execute()
}
