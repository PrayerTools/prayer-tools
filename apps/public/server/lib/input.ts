// Parsing of untrusted form / app input into the shapes the shared domain
// functions take. Pure, so it is unit-tested.
import type { RuleInput } from '@prayertools/shared/subscriptions'
import type { SignupFieldKind } from '@prayertools/shared/db/schema'

export function parseRuleInput(raw: unknown): RuleInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = r.kind === 'dates' ? 'dates' : 'recurring'
  const time = typeof r.time === 'string' ? r.time.slice(0, 5) : ''
  const out: RuleInput = { kind, time }
  if (kind === 'recurring') {
    out.frequency = r.frequency === 'weekly' || r.frequency === 'monthly' ? r.frequency : 'daily'
    out.days_of_week = Array.isArray(r.days_of_week)
      ? [...new Set(r.days_of_week.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
      : []
    if (out.frequency === 'monthly') {
      const day = Number(r.day_of_month)
      out.day_of_month = r.day_of_month === null || r.day_of_month === undefined || r.day_of_month === '' ? null : Number.isInteger(day) ? day : NaN
    }
  } else {
    out.dates = Array.isArray(r.dates)
      ? r.dates.filter((d): d is string => typeof d === 'string' && !Number.isNaN(Date.parse(d))).slice(0, 200).map(d => new Date(d).toISOString())
      : []
  }
  if (r.duration_min === null || r.duration_min === undefined || r.duration_min === '') out.duration_min = null
  else {
    const n = Number(r.duration_min)
    out.duration_min = Number.isInteger(n) ? n : NaN
  }
  if (typeof r.timezone === 'string' && r.timezone) out.timezone = r.timezone.slice(0, 64)
  return out
}

export interface FieldDef {
  key: string
  kind: SignupFieldKind
  required: boolean
  options: { key: string }[]
}

// Custom signup answers, stored on the CRM contact under `pt_<key>`.
export function parseAnswers(fields: FieldDef[], raw: unknown): { answers: Record<string, unknown>, missing: string[] } {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const answers: Record<string, unknown> = {}
  const missing: string[] = []
  for (const f of fields) {
    const v = input[f.key]
    let value: unknown = null
    if (f.kind === 'text' && typeof v === 'string' && v.trim()) value = v.trim().slice(0, 500)
    if (f.kind === 'select' && typeof v === 'string' && f.options.some(o => o.key === v)) value = v
    if (f.kind === 'checkbox') value = v === true
    if (f.required && (value === null || value === false)) missing.push(f.key)
    if (value !== null) answers[`pt_${f.key}`] = value
  }
  return { answers, missing }
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
