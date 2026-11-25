import type { Tx } from '@prayertools/shared/db/scope'
import { addDays, addMonths, todayIn } from '@prayertools/shared/dates'
import { campaignEndDate, campaignStatus, displayLength } from '@prayertools/shared/setup'
import { dailyGoalPercents, goalProgress, minutesCommitted, prayingNow, signupsCount, statTotals } from '@prayertools/shared/stats'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import type { CampaignRunView, GoalProgressView, StatsView } from '../../shared/view'

export async function progressFor(tx: Tx, c: CampaignRow, defaultMinutes: number): Promise<GoalProgressView> {
  return await goalProgress(tx, c, defaultMinutes)
}

// Everyone who has signed up since an ongoing campaign began. A fixed campaign's
// people count already includes everyone who committed, so it has none.
export async function signedUpFor(tx: Tx, c: CampaignRow): Promise<number | null> {
  return displayLength(c) === 'ongoing' ? await signupsCount(tx, c.id) : null
}

export async function runFor(tx: Tx, c: CampaignRow, defaultMinutes: number): Promise<CampaignRunView | null> {
  if (c.start_mode !== 'date' || !c.start_date) return null
  const end = campaignEndDate(c)
  const today = todayIn(c.timezone)
  if (!end) return { start: c.start_date, end, today, calendar: null }
  const anchor = today < c.start_date ? c.start_date : today > end ? end : today
  const first = `${anchor.slice(0, 7)}-01`
  const months = [first, addMonths(first, 1)].filter(m => m <= end)
  const from = c.start_date > first ? c.start_date : first
  const monthsEnd = addDays(addMonths(months.at(-1)!, 1), -1)
  const to = end < monthsEnd ? end : monthsEnd
  const percents = await dailyGoalPercents(tx, c, from, to, defaultMinutes)
  const days: { date: string, percent: number | null }[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) days.push({ date, percent: percents?.[days.length] ?? null })
  return { start: c.start_date, end, today, calendar: { months, days } }
}

export async function statsFor(tx: Tx, c: CampaignRow, defaultMinutes: number): Promise<StatsView> {
  const ended = campaignStatus(c) === 'ended'
  const [progress, signedUp, committed, totals, now, commitments] = [
    await progressFor(tx, c, defaultMinutes),
    await signedUpFor(tx, c),
    ended ? await minutesCommitted(tx, c, defaultMinutes) : null,
    await statTotals(tx, c.id),
    await prayingNow(tx),
    await tx
      .selectFrom('pt_commitment as cm')
      .innerJoin('pt_subscription as s', 's.id', 'cm.subscription_id')
      .select(eb => eb.fn.countAll<string>().as('n'))
      .where('cm.campaign_id', '=', c.id)
      .where('cm.paused', '=', false)
      .where('s.status', 'in', ['active', 'completed'])
      .where(eb => eb.or([eb('s.verified_at', 'is not', null), eb('s.delivery', '=', 'app')]))
      .executeTakeFirst()
  ]
  return {
    progress,
    signedUp,
    commitments: Number(commitments?.n ?? 0),
    prayers: totals.prayers ?? 0,
    prayerMinutes: Math.round((totals.prayer_seconds ?? 0) / 60),
    minutesCommitted: committed,
    groupPrayers: totals.group_prayers ?? 0,
    prayingNow: now
  }
}
