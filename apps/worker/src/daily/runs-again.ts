// "Notify me when this campaign runs again": once the next run in a campaign's
// series is published, each confirmed request is claimed and emailed once. The
// claim commits before the send, so a crash or retry never emails twice; a send
// that fails is released for the next sweep. Requests whose address is
// suppressed or no longer accepts site updates keep waiting.
import { sql } from 'kysely'
import { forEachOrg } from '@prayertools/shared/db/scope'
import { campaignSegment, loadCampaigns } from '@prayertools/shared/campaigns'
import { primaryEmailOf, PURPOSE_SITE_UPDATES } from '@prayertools/shared/crm'
import { todayIn } from '@prayertools/shared/dates'
import { suppressedAmong } from '@prayertools/shared/email/suppression'
import { loadSiteMailContext, runsAgainEmail } from '@prayertools/shared/email/templates'
import type { OutgoingMail } from '@prayertools/shared/email/transport'
import { nextRun } from '@prayertools/shared/notify-requests'
import { sitePath } from '@prayertools/shared/paths'
import { pickCurrentCampaign } from '@prayertools/shared/setup'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import type { WorkerContext } from '../context'
import type { Logger } from '../log'
import { personLanguage, siteMail, siteRow } from '../mail'
import { mapPool } from '../util'

const SEND_CONCURRENCY = 10

export async function announceRunsAgain(ctx: WorkerContext, log: Logger): Promise<Record<string, number>> {
  const now = ctx.now()
  // Sites with confirmed requests and a relaunch published after the campaign asked on.
  const due = await sql<{ org_id: string }>`
    SELECT DISTINCT r.org_id::text AS org_id
    FROM pt_notify_request r
    JOIN pt_site s ON s.org_id = r.org_id AND s.status = 'published'
    JOIN pt_campaign asked ON asked.id = r.campaign_id
    WHERE r.confirmed_at IS NOT NULL AND r.notified_at IS NULL
      AND EXISTS (
        SELECT 1 FROM pt_campaign k
        WHERE k.org_id = r.org_id AND k.relaunch_of IS NOT NULL AND k.published_at IS NOT NULL
          AND k.ended_at IS NULL AND k.created_at > asked.created_at
      )
  `.execute(ctx.admin)

  let skipped = 0
  const claimed = await forEachOrg(ctx.app, due.rows.map(r => r.org_id), async (tx, orgId) => {
    const site = await siteRow(tx)
    if (site?.status !== 'published') return []
    const requests = await tx
      .selectFrom('pt_notify_request')
      .select(['id', 'contact_id', 'campaign_id', 'language'])
      .where('confirmed_at', 'is not', null)
      .where('notified_at', 'is', null)
      .orderBy('id')
      .execute()
    const next = new Map<string, CampaignRow | null>()
    for (const id of new Set(requests.map(r => r.campaign_id))) next.set(id, await nextRun(tx, id, now))
    const answered = requests.filter(r => next.get(r.campaign_id))
    if (!answered.length) return []

    const emails = new Map<string, { channelId: string, email: string }>()
    for (const r of answered) {
      const e = await primaryEmailOf(tx, r.contact_id)
      if (e) emails.set(r.id, e)
    }
    const channelIds = [...new Set([...emails.values()].map(e => e.channelId))]
    const consented = new Set(channelIds.length
      ? (await tx.selectFrom('crm_channel_consents').select('channel_id').where('channel_id', 'in', channelIds).where('purpose', '=', PURPOSE_SITE_UPDATES).where('status', '=', 'opt_in').execute()).map(c => c.channel_id)
      : [])
    const suppressed = await suppressedAmong(tx, [...emails.values()].map(e => e.email))

    const mctx = await loadSiteMailContext(tx, orgId)
    const current = pickCurrentCampaign(await loadCampaigns(tx), now)?.campaign
    const out: { id: string, mail: OutgoingMail }[] = []
    for (const r of answered) {
      const to = emails.get(r.id)
      if (!to || !consented.has(to.channelId) || suppressed.has(to.email.trim().toLowerCase())) {
        skipped++
        continue
      }
      const run = next.get(r.campaign_id)!
      const marked = await tx.updateTable('pt_notify_request')
        .set({ notified_at: now, notified_campaign_id: run.id })
        .where('id', '=', r.id)
        .where('notified_at', 'is', null)
        .returning('id')
        .executeTakeFirst()
      if (!marked) continue
      const lang = personLanguage(r.language, site)
      const path = sitePath({ lang, defaultLang: site.default_language, campaignSlug: campaignSegment(run, current?.id), page: 'signup' })
      const rendered = runsAgainEmail(mctx, lang, {
        campaignName: run.name,
        startsOn: run.start_mode === 'date' && run.start_date && run.start_date > todayIn(run.timezone, now) ? run.start_date : null,
        signupUrl: `${mctx.siteUrl}${path}`
      })
      out.push({ id: r.id, mail: siteMail(mctx, to.email, rendered, 'runs_again', null) })
    }
    return out
  }, (orgId, err) => log.error('runs_again.claim_failed', { site: orgId, err }))

  let sent = 0
  let failed = 0
  for (const [orgId, mails] of claimed) {
    const results = await mapPool(mails, SEND_CONCURRENCY, async m => await ctx.sendMail(m.mail))
    const released = mails.filter((_, i) => !results[i]!.ok).map(m => m.id)
    sent += mails.length - released.length
    failed += released.length
    if (released.length) {
      log.error('runs_again.send_failed', { site: orgId, count: released.length })
      await forEachOrg(ctx.app, [orgId], tx => tx.updateTable('pt_notify_request')
        .set({ notified_at: null, notified_campaign_id: null })
        .where('id', 'in', released)
        .where('notified_at', '=', now)
        .execute(), (id, err) => log.error('runs_again.release_failed', { site: id, err }))
    }
  }
  return { sent, skipped, failed }
}
