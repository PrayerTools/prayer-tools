// prayer.tools mail on the Nuxtinator mail kernel (@nuxtinator/mail). Every
// process shares these stream definitions: the admin app registers them with
// core's kernel, the worker builds a sending kernel and the public server an
// enqueue-only one. Each process names its kernel once with `providePtMail`.
import type { Kysely, Transaction } from 'kysely'
import { createMail, type Mail, type MailProvider, type MailStream, type OutgoingMail, type SendResult } from '@nuxtinator/mail/kernel'
import { mailgunProvider, sendgridProvider, sesProvider } from '@nuxtinator/mail/adapters'
import { createFakeProvider } from '@nuxtinator/mail/test'

export type { Mail, MailStream, OutgoingMail, SendResult }

// Streams with `orgAssignable` follow a site's own verified domain when the
// mail carries the site's org id; otherwise the host's routes and the env
// domain apply. Complaints are scoped to the org a mail names.
export const PT_STREAMS = {
  // Links the person just asked for: verification, manage links, sign-in
  // links, address changes. Skips suppressions, so asking again reaches a
  // bounced address and a delivery lifts the block.
  confirmations: { id: 'confirmations', label: 'Confirmations and sign-in links', defaultLocal: 'noreply', orgAssignable: true, userInitiated: true, queued: true, maxAgeMinutes: 60 },
  // A site's mail to its intercessors: reminders, welcomes, check-ins,
  // thank-yous, acknowledgements.
  site: { id: 'site', label: 'Site mail (reminders, welcomes, check-ins)', defaultLocal: 'noreply', orgAssignable: true, bulk: true, queued: true, maxAgeMinutes: 360 },
  // Site marketing. The marketing layer's delivery table is its queue.
  marketing: { id: 'marketing', label: 'Site marketing', defaultLocal: 'noreply', orgAssignable: true, bulk: true },
  // Prayer.Tools' own notices to site teams and accounts.
  platform: { id: 'platform', label: 'Prayer.Tools notices', defaultLocal: 'noreply', orgAssignable: false, queued: true }
} satisfies Record<string, MailStream>

export type PtStream = keyof typeof PT_STREAMS

// The inbox layer's stream as that layer registers it. Processes outside the
// admin app know it only to resolve a site's inbox address.
const INBOX_STREAM: MailStream = { id: 'inbox', label: 'Inbox', defaultLocal: 'contact', orgAssignable: true, needsReceive: true }

export interface PtMailOptions {
  db: Kysely<any>
  // Sending needs the admin app's NUXT_SECRET_ENCRYPTION_KEY; with only the
  // outbox public key the kernel can enqueue but not send.
  secretKey?: string
  outboxPublicKey?: string
  subscribe?: (channel: string, onNotify: () => void) => void
  sweepSeconds?: number
  log?: (line: string) => void
}

// A kernel for a process outside the admin app, with the same providers and
// streams the admin app has.
export function createPtMail(opts: PtMailOptions): Mail {
  const providers: MailProvider[] = [mailgunProvider, sesProvider, sendgridProvider]
  if (process.env.MAIL_FAKE_PROVIDER === '1') providers.push(createFakeProvider())
  return createMail({
    db: opts.db,
    providers,
    streams: [...Object.values(PT_STREAMS), INBOX_STREAM],
    env: process.env,
    secretKey: opts.secretKey || undefined,
    outboxPublicKey: opts.outboxPublicKey || undefined,
    subscribe: opts.subscribe,
    sweepSeconds: opts.sweepSeconds,
    log: opts.log
  })
}

let source: (() => Promise<Mail>) | null = null

export function providePtMail(get: () => Promise<Mail>): void {
  source = get
}

export async function ptMail(): Promise<Mail> {
  if (!source) throw new Error('No mail kernel: this process never called providePtMail')
  return await source()
}

// Sends now on its own connection; never inside a transaction.
export async function sendPtMail(m: OutgoingMail): Promise<SendResult> {
  return await (await ptMail()).send(m)
}

// Writes the mail to the outbox in `tx`; a sending process delivers it once
// the transaction commits.
export async function enqueuePtMail(tx: Transaction<any>, m: OutgoingMail): Promise<void> {
  await (await ptMail()).enqueue(m, { tx })
}

// Handed to the provider, queued for delivery, or sent with an unknown outcome
// (never retried).
export function accepted(r: SendResult): boolean {
  return r.status === 'sent' || r.status === 'queued' || r.status === 'unknown'
}

// A send that neither went out nor was skipped for a suppression, as an error
// the caller's retry logic understands.
export class MailNotSent extends Error {
  constructor(public readonly result: SendResult, public readonly retryable: boolean) {
    super(`Mail not sent: ${result.status}${'error' in result ? ` (${result.error})` : 'reason' in result ? ` (${result.reason})` : ''}`)
  }
}

export function failure(r: SendResult): MailNotSent | null {
  if (accepted(r) || r.status === 'suppressed') return null
  return new MailNotSent(r, r.status === 'no_sender' || (r.status === 'failed' && r.retryable))
}
