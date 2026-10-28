// A site's push announcement to its active app intercessors, in each
// person's language (falling back to the source language).
import { withOrg } from '@prayertools/shared/db/scope'
import { textIn } from '@prayertools/shared/translatable'
import type { TranslatableText } from '@prayertools/shared/db/schema'
import { JobError, requireString, type JobHandler } from './registry'

export const pushAnnouncementJob: JobHandler = async (ctx, payload) => {
  const orgId = requireString(payload, 'orgId')
  const heading = payload.heading as TranslatableText | undefined
  const body = payload.body as TranslatableText | undefined
  if (!heading || !body) throw new JobError('heading and body are required', false)
  if (!ctx.push) return { skipped: 'push not configured' }
  const recipients = await withOrg(ctx.app, orgId, tx => tx
    .selectFrom('pt_subscription as s')
    .innerJoin('pt_user_device as d', 'd.user_id', 's.user_id')
    .select(['s.language', 'd.push_id'])
    .where('s.delivery', '=', 'app')
    .where('s.status', '=', 'active')
    .where('d.push_id', 'is not', null)
    .execute())
  const byLang = new Map<string, string[]>()
  for (const r of recipients) byLang.set(r.language, [...(byLang.get(r.language) ?? []), r.push_id!])
  let pushed = 0
  for (const [lang, ids] of byLang) {
    await ctx.push({ pushIds: ids, heading: textIn(heading, lang), body: textIn(body, lang), data: { type: 'announcement', site_id: orgId } })
    pushed += ids.length
  }
  return { pushed }
}
