// The public server only queues mail: its kernel holds the outbox public key
// (MAIL_OUTBOX_PUBLIC_KEY, shown on the admin app's Admin → Email page) and
// the worker sends. Built on first use, on the RLS connection.
import { createPtMail, providePtMail, type Mail } from '@prayertools/shared/email/mail'
import { useDb } from '../utils/db'

export default defineNitroPlugin(() => {
  let mail: Mail | null = null
  providePtMail(async () => {
    mail ??= createPtMail({ db: useDb(), outboxPublicKey: process.env.MAIL_OUTBOX_PUBLIC_KEY })
    return mail
  })
})
