import { updateCommitment } from '@prayertools/shared/subscriptions'
import { validateRule } from '@prayertools/shared/schedule'
import { frequencyOptions } from '@prayertools/shared/setup'

export default definePtHandler('pt.intercessors.write', async (event, tx) => {
  const id = getRouterParam(event, 'id')!
  const cid = getRouterParam(event, 'cid')!
  const b = await ptBody<{ frequency?: 'daily' | 'weekly' | 'monthly', days_of_week?: number[], day_of_month?: number | null, time?: string, duration_min?: number | null, paused?: boolean }>(event)
  const sub = await tx.selectFrom('pt_subscription').selectAll().where('id', '=', id).executeTakeFirst()
  if (!sub) ptNotFound('Intercessor not found.')
  if (b.time || b.frequency) {
    const errors = validateRule({ kind: 'recurring', frequency: b.frequency ?? 'daily', days_of_week: b.days_of_week ?? [], day_of_month: b.day_of_month ?? null, time: b.time ?? '00:00', duration_min: b.duration_min ?? null })
    const campaign = await tx.selectFrom('pt_commitment as c').innerJoin('pt_campaign as k', 'k.id', 'c.campaign_id').select('k.cadence').where('c.id', '=', cid).executeTakeFirst()
    if (campaign && !frequencyOptions(campaign.cadence).includes(b.frequency ?? 'daily')) errors.push('frequency')
    if (errors.length) ptBadRequest('Please check the prayer time.', { errors })
  }
  const updated = await updateCommitment(ptTx(tx), sub, cid, b)
  if (!updated) ptNotFound('Prayer time not found.')
  return { ok: true }
})
