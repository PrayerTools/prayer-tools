// prayer.tools' mail streams on core's mail kernel, which shared code reaches
// through providePtMail. A spam complaint on a site's mail is recorded as a
// site event, which the marketing layer's complaint-rate pause counts.
import { db } from '#core/server/utils/database'
import { registerMailEventHandler, registerMailStream, useMail } from '#core/server/utils/mail'
import { PT_STREAMS, providePtMail } from '@prayertools/shared/email/mail'
import { withOrg } from '@prayertools/shared/db/scope'
import { recordEvent } from '@prayertools/shared/stats'

export default defineNitroPlugin(() => {
  if (process.env.NUXT_PREPARE_BUILD || process.env.NITRO_PRESET === 'prepare') return
  for (const stream of Object.values(PT_STREAMS)) registerMailStream(stream)
  providePtMail(useMail)

  registerMailEventHandler({
    id: 'pt:complaints',
    types: ['complained'],
    handle: async (event) => {
      if (!event.orgId) return
      // A failure here must not fail the provider's whole event batch.
      await withOrg(db as never, event.orgId, tx => recordEvent(tx, { campaignId: null, type: 'email_complaint', meta: { stream: event.stream } }))
        .catch(err => console.error('[pt] recording a complaint failed:', err))
    }
  })
})
