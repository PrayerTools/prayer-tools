// Progress through a personal-start campaign. A person has one commitment per
// such campaign, which records how many entries they have opened in order.
// They move forward by opening the entry they are on, at most once per day
// (once per week for weekly campaigns) in their own timezone.
import type { Tx } from './db/scope'
import type { Cadence } from './db/schema'
import { daysBetween, todayIn, toIsoDate } from './dates'
import { campaignEntries } from './content'
import type { CampaignRow, CommitmentRow } from './subscriptions'
import { normalizeCampaign } from './campaigns'

// After this many reminders in a row go unopened, reminders drop to weekly.
export const MISSES_BEFORE_WEEKLY = 3

export function periodDays(cadence: Cadence): number {
  return cadence === 'weekly' ? 7 : 1
}

export interface Position {
  // The entry the person is on; `entries + 1` once they have finished.
  current: number
  // They moved forward this day (week), so the next entry opens later.
  movedToday: boolean
  entries: number | null
  finished: boolean
}

export function positionOf(c: Pick<CommitmentRow, 'entries_done' | 'advanced_on' | 'timezone'>, cadence: Cadence, entries: number | null, now: Date = new Date()): Position {
  const done = Number(c.entries_done)
  const advanced = toIsoDate(c.advanced_on as unknown as string | null)
  return {
    current: done + 1,
    movedToday: !!advanced && daysBetween(advanced, todayIn(c.timezone, now)) < periodDays(cadence),
    entries,
    finished: !!entries && done >= entries
  }
}

export async function personalCommitment(tx: Tx, subscriptionId: string, campaignId: string): Promise<CommitmentRow | undefined> {
  return await tx.selectFrom('pt_commitment').selectAll()
    .where('subscription_id', '=', subscriptionId).where('campaign_id', '=', campaignId)
    .orderBy('created_at').executeTakeFirst()
}

// Records that the person opened `entry` and moves them forward when it is the
// one they are on and they have not moved forward yet this day (week). Pass
// null to only read their position. Null when the campaign is not
// personal-start or the person has no commitment in it.
export async function openEntry(tx: Tx, subscriptionId: string, campaign: CampaignRow, entry: number | null, now: Date = new Date()): Promise<Position | null> {
  if (campaign.start_mode !== 'join') return null
  const c = await personalCommitment(tx, subscriptionId, campaign.id)
  if (!c) return null
  const entries = await campaignEntries(tx, normalizeCampaign(campaign))
  const pos = positionOf(c, campaign.cadence, entries, now)
  if (entry !== pos.current || pos.movedToday || pos.finished) return pos
  const today = todayIn(c.timezone, now)
  const moved = await tx.updateTable('pt_commitment')
    .set({ entries_done: entry, advanced_on: today, updated_at: now })
    .where('id', '=', c.id).where('entries_done', '=', entry - 1)
    .returning('id').executeTakeFirst()
  return moved ? positionOf({ ...c, entries_done: entry, advanced_on: today }, campaign.cadence, entries, now) : pos
}
