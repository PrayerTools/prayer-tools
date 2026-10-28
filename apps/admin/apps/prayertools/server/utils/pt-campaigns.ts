import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import { applyTemplate, DEFAULT_SLOT_MIN, overlappingCampaign, SLOT_OPTIONS, validateSetup, type SetupAnswers } from '@prayertools/shared/setup'
import type { CampaignKind } from '@prayertools/shared/db/schema'
import { campaignSlugError } from '@prayertools/shared/paths'
import { isValidTimezone } from '@prayertools/shared/dates'
import { parseText } from '@prayertools/shared/translatable'
import { parsePlaceWording } from '@prayertools/shared/place'
import { jsonb } from '@prayertools/shared/db/json'
import { loadCampaigns } from '@prayertools/shared/campaigns'

export function ptSetupFromBody(b: Record<string, unknown>, templateKey: string, base?: Partial<SetupAnswers>, kind: CampaignKind | null = null): SetupAnswers {
  const chosen: Partial<SetupAnswers> = { ...base }
  for (const k of ['start_mode', 'start_date', 'end_mode', 'end_date', 'length_days', 'goal', 'cadence', 'track_time'] as const) {
    if (k in b) (chosen as Record<string, unknown>)[k] = b[k]
  }
  const answers = applyTemplate(templateKey, chosen)
  const errors = validateSetup(answers, kind)
  if (errors.length) ptBadRequest(kind === 'side' ? 'A side campaign needs a start date and an end date.' : 'Please check the campaign setup.', { errors })
  return answers
}

export async function ptAssertNoOverlap(tx: Transaction<Database>, answers: SetupAnswers & { timezone: string }, kind: CampaignKind | null, exceptId?: string) {
  if (kind === 'side') return
  const others = (await loadCampaigns(ptTx(tx), { drafts: true })).filter(c => !c.ended_at && c.id !== exceptId)
  const clash = overlappingCampaign(answers, kind, others)
  if (clash) ptBadRequest(`These dates overlap "${clash.name}". A site runs one main campaign at a time; a side campaign can run alongside it.`)
}

export function ptCampaignKind(input: unknown): CampaignKind | null {
  return input === 'side' ? 'side' : null
}

export function ptCampaignExtras(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  if (typeof b.name === 'string') {
    const name = b.name.trim()
    if (name.length < 2 || name.length > 120) ptBadRequest('Campaign name must be 2–120 characters.')
    out.name = name
  }
  if (typeof b.slug === 'string' && b.slug) {
    if (campaignSlugError(b.slug)) ptBadRequest('The campaign address may use lowercase letters, digits and hyphens, and cannot be a page name or language code.')
    out.slug = b.slug
  }
  if ('timezone' in b && b.timezone) {
    if (!isValidTimezone(b.timezone)) ptBadRequest('Unknown timezone.')
    out.timezone = b.timezone
  }
  for (const k of ['place_name', 'people_group'] as const) {
    if (k in b) out[k] = typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string).trim().slice(0, 200) : null
  }
  if ('place_wording' in b) out.place_wording = jsonb(parsePlaceWording(b.place_wording))
  for (const k of ['latitude', 'longitude'] as const) {
    if (k in b) {
      const v = b[k]
      if (v !== null && (typeof v !== 'number' || Math.abs(v) > (k === 'latitude' ? 90 : 180))) ptBadRequest(`Invalid ${k}.`)
      out[k] = v
    }
  }
  if ('goal_target' in b) {
    const v = b.goal_target
    if (v !== null && !(Number.isInteger(v) && (v as number) > 0 && (v as number) < 10_000_000)) ptBadRequest('Goal target must be a positive whole number.')
    out.goal_target = v
  }
  if ('slot_min' in b) {
    const v = b.slot_min
    if (v !== null && !SLOT_OPTIONS.includes(v as number)) ptBadRequest('Choose a slot length from the list.')
    out.slot_min = v === DEFAULT_SLOT_MIN ? null : v
  }
  return out
}

export function ptCta(input: unknown) {
  const c = (input ?? {}) as Record<string, unknown>
  const url = typeof c.url === 'string' && /^https?:\/\//.test(c.url) ? c.url.slice(0, 2000) : undefined
  const label = parseText(c.label) ?? undefined
  return url && label ? { url, label } : {}
}
