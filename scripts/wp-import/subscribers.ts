// WordPress `subscriptions` posts and their `dt_reports` prayer times → v3
// contacts, subscriptions, commitments and legacy link keys for one site.
import { sql } from 'kysely'
import type { SQL } from 'bun'
import type { Tx } from '@prayertools/shared/db/scope'
import { pgArray } from '@prayertools/shared/db/json'
import { markChannelVerified, normalizeEmail, PURPOSE_PLATFORM_NEWS, setConsent, upsertContact } from '@prayertools/shared/crm'
import { accountByEmail, ensureAccount, linkContactToAccount, linkSubscriptionToAccount, markAccountVerified } from '@prayertools/shared/accounts'
import { refreshReminders, VERIFY_TOKEN_DAYS, type CampaignRow } from '@prayertools/shared/subscriptions'
import { loadSiteMailContext, verificationEmail } from '@prayertools/shared/email/templates'
import { enqueuePtMail, PT_STREAMS } from '@prayertools/shared/email/mail'
import { logEmails } from '@prayertools/shared/email/log'
import { addDays, localDateOf, localTimeOf } from '@prayertools/shared/dates'
import { DURATION_OPTIONS, durationOptions } from '@prayertools/shared/setup'
import { hashToken, randomToken, shortCode } from '@prayertools/shared/tokens'
import { first, languageOf, metaOf, postsOf, table, tableExists, unserialize, wpDate, type Meta } from './wp'
import { validTimezone } from './campaigns'
import { answersOf, type ImportedField } from './signup-fields'
import { pickedPlan, ruleRuns, toMonthly, type RulePlan } from './times'

export const IMPORT_SOURCE = 'WordPress import'

export interface SubscriberCounts {
  subscriptions: number
  merged: number
  noEmail: number
  invalidEmail: number
  unverified: number
  unsubscribed: number
  recurring: number
  recurringFromPicked: number
  pickedAsRules: number
  dates: number
  datesSkipped: number
  pickedDuplicates: number
  deletedRules: number
  rulesWithoutTimes: number
  pendingSkipped: number
  pendingImported: number
  confirmationsQueued: number
  madeMonthly: number
  remindersOff: number
  legacyKeys: number
}

export interface NewsRequest { email: string, name: string | null, at: Date }

interface Report {
  id: number
  parent_id: number
  post_id: number
  type: string
  subtype: string | null
  value: number
  time_begin: number
  time_end: number
}

function emailOf(m: Meta | undefined): { email: string, verified: boolean } | null {
  for (const [key, values] of m ?? []) {
    if (!/^contact_email(_[0-9a-z]+)?$/.test(key) || key.endsWith('_details')) continue
    const email = values[0]?.trim()
    if (!email) continue
    const details = unserialize(m?.get(`${key}_details`)?.[0]) as { verified?: boolean } | null
    return { email, verified: !!details?.verified }
  }
  return null
}

// The shortest allowed prayer length at least as long as the one chosen.
function duration(minutes: number, c: CampaignRow): number {
  const options = c.goal === 'coverage' ? durationOptions(c) : [...DURATION_OPTIONS]
  return options.find(o => o >= minutes) ?? options[options.length - 1]!
}

function commitmentEnd(c: CampaignRow, lastDay: string, lastAt: Date, active: boolean, now: Date): string | null {
  const end = c.end_date as string | null
  if (end) return lastDay >= addDays(end, -1) || lastDay > end ? end : lastDay
  return active && lastAt > now ? null : lastDay
}

// Unconfirmed WordPress signups come across only when this recent, with a new
// confirmation email; older ones would be deleted by v3's unverified cleanup.
export const PENDING_DAYS = VERIFY_TOKEN_DAYS

export async function importSubscribers(wp: SQL, blogId: number, tx: Tx, input: {
  orgId: string
  sendConfirmations: boolean
  fields: ImportedField[]
  campaigns: Map<number, CampaignRow>
  languages: string[]
  defaultLanguage: string
  now: Date
}): Promise<{ counts: SubscriberCounts, news: NewsRequest[], warnings: string[], names: Map<string, string>, emails: Set<string> }> {
  const counts: SubscriberCounts = { subscriptions: 0, merged: 0, noEmail: 0, invalidEmail: 0, unverified: 0, unsubscribed: 0, recurring: 0, recurringFromPicked: 0, pickedAsRules: 0, dates: 0, datesSkipped: 0, pickedDuplicates: 0, deletedRules: 0, rulesWithoutTimes: 0, pendingSkipped: 0, pendingImported: 0, confirmationsQueued: 0, madeMonthly: 0, remindersOff: 0, legacyKeys: 0 }
  const news: NewsRequest[] = []
  const warnings: string[] = []
  const names = new Map<string, string>()
  const emails = new Set<string>()
  const posts = await postsOf(wp, blogId, 'subscriptions')
  if (!posts.length) return { counts, news, warnings, names, emails }
  const meta = await metaOf(wp, blogId, posts.map(p => p.ID))

  const links = await wp.unsafe(`SELECT p2p_from, p2p_to FROM ${table(blogId, 'p2p')} WHERE p2p_type = 'campaigns_to_subscriptions'`) as { p2p_from: number, p2p_to: number }[]
  const campaignsOf = new Map<number, Set<number>>()
  for (const l of links) {
    const set = campaignsOf.get(Number(l.p2p_to)) ?? new Set()
    set.add(Number(l.p2p_from))
    campaignsOf.set(Number(l.p2p_to), set)
  }

  const reports = await tableExists(wp, table(blogId, 'dt_reports'))
    ? await wp.unsafe(
      `SELECT id, parent_id, post_id, type, subtype, value, time_begin, time_end FROM ${table(blogId, 'dt_reports')}
       WHERE post_type = 'subscriptions' AND (type = 'recurring_signup' OR (type IN ('campaign_app', 'pending_signup') AND subtype IN ('recurring_signup', 'selected_time')))
       ORDER BY time_begin`
    ) as Report[]
    : []
  const reportsOf = new Map<number, Report[]>()
  for (const r of reports) {
    const list = reportsOf.get(Number(r.post_id)) ?? []
    list.push(r)
    reportsOf.set(Number(r.post_id), list)
  }

  // Addresses confirmed on another of this site's subscriptions: their pending
  // signups merge into the confirmed one.
  const confirmed = new Set<string>()
  for (const p of posts) {
    const m = meta.get(p.ID)
    const e = emailOf(m)
    if (!e) continue
    const address = normalizeEmail(e.email).normalized
    emails.add(address)
    if ((first(m, 'status') ?? 'active') !== 'pending' || e.verified) confirmed.add(address)
  }

  const seenKeys = new Set<string>()
  for (const p of posts) {
    const m = meta.get(p.ID)
    const found = emailOf(m)
    if (!found) { counts.noEmail++; continue }
    const { normalized, valid } = normalizeEmail(found.email)
    if (!valid) { counts.invalidEmail++; continue }
    const wpStatus = first(m, 'status') ?? 'active'
    const verified = wpStatus !== 'pending' || found.verified
    const unsubscribed = wpStatus === 'inactive'
    const recentPending = !verified && !confirmed.has(normalized) && input.now.getTime() - wpDate(p.post_date_gmt).getTime() <= PENDING_DAYS * 86_400_000
    if (!verified && !confirmed.has(normalized) && !recentPending) { counts.pendingSkipped++; continue }
    const locale = languageOf(first(m, 'lang'))
    const language = input.languages.includes(locale) ? locale : input.defaultLanguage
    const firstCampaign = [...(campaignsOf.get(p.ID) ?? [])].map(id => input.campaigns.get(id)).find(Boolean)
    const timezone = validTimezone(first(m, 'timezone')) ?? firstCampaign?.timezone ?? 'UTC'
    const name = p.post_title.trim() && !p.post_title.includes('@') ? p.post_title.trim().slice(0, 200) : null
    if (name) names.set(normalized, name)
    // A recent pending signup starts its confirmation window at the import.
    const createdAt = recentPending ? input.now : wpDate(p.post_date_gmt)
    const modifiedTs = Number(first(m, 'subscriber_last_modified') ?? first(m, 'last_modified')) || 0
    const modifiedAt = modifiedTs ? new Date(modifiedTs * 1000) : wpDate(p.post_modified_gmt)

    const contact = await upsertContact(tx, { email: normalized, name, data: { pt_language: language, ...answersOf(input.fields, k => m?.get(k)?.[0]) }, source: IMPORT_SOURCE })
    let sub = await tx.selectFrom('pt_subscription').selectAll().where('contact_id', '=', contact.contactId).executeTakeFirst()
    if (sub) {
      counts.merged++
      sub = await tx.updateTable('pt_subscription').set({
        created_at: sql`least(created_at, ${createdAt}::timestamptz)`,
        ...(verified && !sub.verified_at ? { verified_at: createdAt } : {}),
        ...(!unsubscribed && sub.status === 'unsubscribed' ? { status: 'active', unsubscribed_at: null } : {})
      }).where('id', '=', sub.id).returningAll().executeTakeFirstOrThrow()
    } else {
      counts.subscriptions++
      sub = await tx.insertInto('pt_subscription').values({
        contact_id: contact.contactId,
        status: unsubscribed ? 'unsubscribed' : 'active',
        language,
        timezone,
        verified_at: verified ? createdAt : null,
        referral_code: shortCode(6),
        last_activity_at: modifiedAt,
        checkin_cycle_started_at: input.now,
        unsubscribed_at: unsubscribed ? modifiedAt : null,
        created_at: createdAt,
        updated_at: modifiedAt
      }).returningAll().executeTakeFirstOrThrow()
    }
    if (!verified) counts.unverified++
    if (unsubscribed) counts.unsubscribed++
    // Reminders turned off in WordPress (stored as '0' or ''): the prayer times come across paused.
    const notify = m?.get('receive_prayer_time_notifications')?.[0]
    const remindersOff = notify === '0' || notify === ''
    if (remindersOff) counts.remindersOff++

    if (verified) {
      await markChannelVerified(tx, contact.channelId)
      const account = await ensureAccount(tx, normalized)
      if (!account.display_name && name) await tx.updateTable('users').set({ display_name: name }).where('id', '=', account.id).where('display_name', '=', '').execute()
      await markAccountVerified(tx, account.id)
      await linkSubscriptionToAccount(tx, sub.id, { ...account, display_name: account.display_name || name || '', verified: true })
    }
    if (first(m, 'receive_prayer_tools_news') === '1') {
      if (verified) news.push({ email: normalized, name, at: createdAt })
      else await tx.updateTable('pt_subscription').set({ platform_news_requested_at: createdAt }).where('id', '=', sub.id).execute()
    }

    // Prayer times convert from WordPress's per-time rows (see times.ts).
    const byCampaign = new Map<number, { rules: Map<number, Report>, ruleTimes: Map<number, Report[]>, picked: Report[] }>()
    for (const r of reportsOf.get(p.ID) ?? []) {
      const wpCampaignId = Number(r.parent_id)
      if (!input.campaigns.has(wpCampaignId)) continue
      let g = byCampaign.get(wpCampaignId)
      if (!g) byCampaign.set(wpCampaignId, g = { rules: new Map(), ruleTimes: new Map(), picked: [] })
      if (r.type === 'recurring_signup') g.rules.set(Number(r.id), r)
      else if (r.subtype === 'recurring_signup') g.ruleTimes.set(Number(r.value), [...(g.ruleTimes.get(Number(r.value)) ?? []), r])
      else g.picked.push(r)
    }
    const row = (r: Report) => ({ begin: Number(r.time_begin), end: Number(r.time_end) })
    for (const [wpCampaignId, g] of byCampaign) {
      const c = input.campaigns.get(wpCampaignId)!
      for (const id of g.rules.keys()) if (!g.ruleTimes.has(id)) counts.rulesWithoutTimes++
      const rules: RulePlan[] = []
      for (const [ruleId, rows] of g.ruleTimes) {
        const rule = g.rules.get(ruleId)
        if (!rule) counts.deletedRules++
        rules.push(...ruleRuns(rows.map(row), timezone, rule ? (rule.subtype === 'weekly' ? 'weekly' : 'daily') : null, !!rule))
      }
      counts.recurring += rules.length
      const ruleBegins = new Set([...g.ruleTimes.values()].flat().map(r => Number(r.time_begin)))
      const picked = pickedPlan(g.picked.map(row), ruleBegins, timezone)
      counts.recurringFromPicked += picked.rules.length
      counts.pickedAsRules += picked.pickedAsRules
      counts.pickedDuplicates += picked.duplicates
      const all = c.cadence === 'monthly' ? toMonthly([...rules, ...picked.rules]) : [...rules, ...picked.rules]
      if (c.cadence === 'monthly') counts.madeMonthly += rules.length + picked.rules.length
      for (const rule of all) {
        await tx.insertInto('pt_commitment').values({
          subscription_id: sub.id,
          campaign_id: c.id,
          kind: 'recurring',
          frequency: rule.frequency,
          days_of_week: pgArray(rule.days, 'smallint'),
          day_of_month: rule.frequency === 'monthly' ? (rule.dayOfMonth ?? null) : null,
          paused: remindersOff,
          time: rule.time,
          timezone,
          duration_min: duration(rule.minutes, c),
          dates: pgArray([], 'timestamptz'),
          starts_on: rule.startsOn,
          ends_on: rule.open ? commitmentEnd(c, rule.endsOn, rule.lastAt, !unsubscribed, input.now) : rule.endsOn,
          created_at: createdAt,
          updated_at: modifiedAt
        }).execute()
      }
      if (!picked.dates) continue
      if (c.goal !== 'coverage') { counts.datesSkipped += picked.dates.times.length; continue }
      const times = picked.dates.times
      await tx.insertInto('pt_commitment').values({
        subscription_id: sub.id,
        campaign_id: c.id,
        kind: 'dates',
        frequency: null,
        days_of_week: pgArray([], 'smallint'),
        time: localTimeOf(times[0]!, timezone),
        timezone,
        duration_min: duration(picked.dates.minutes, c),
        dates: sql<Date[]>`${`{${times.map(t => `"${t.toISOString()}"`).join(',')}}`}::timestamptz[]`,
        starts_on: localDateOf(times[0]!, timezone),
        ends_on: localDateOf(times[times.length - 1]!, timezone),
        paused: remindersOff,
        created_at: createdAt,
        updated_at: modifiedAt
      }).execute()
      counts.dates++
    }
    await refreshReminders(tx, sub.id)

    if (recentPending && !sub.verified_at) {
      counts.pendingImported++
      const token = randomToken(24)
      await tx.updateTable('pt_subscription').set({ verify_token_hash: hashToken(token), verify_expires_at: new Date(input.now.getTime() + VERIFY_TOKEN_DAYS * 86_400_000) }).where('id', '=', sub.id).execute()
      if (input.sendConfirmations) {
        const mail = await loadSiteMailContext(tx, input.orgId)
        const rendered = verificationEmail(mail, language, `${mail.siteUrl}/verify/${token}`)
        await enqueuePtMail(tx, { stream: PT_STREAMS.confirmations.id, orgId: input.orgId, to: normalized, fromName: mail.fromName, fromLocal: mail.fromLocal, replyTo: mail.replyTo ?? undefined, subject: rendered.subject, html: rendered.html, text: rendered.text })
        await logEmails(tx, [{ subscriptionId: sub.id, kind: 'verify', subject: rendered.subject }])
        counts.confirmationsQueued++
      }
    }

    for (const [kind, key] of [['manage', first(m, 'subscriptions_app_manage_magic_key')], ['fuel', first(m, 'prayer_fuel_magic_key')]] as const) {
      if (!key || seenKeys.has(`${kind}:${key}`)) continue
      seenKeys.add(`${kind}:${key}`)
      await tx.insertInto('pt_legacy_key').values({ org_id: sql`current_org_id()`, kind, key_hash: hashToken(key), subscription_id: sub.id })
        .onConflict(oc => oc.columns(['kind', 'key_hash']).doNothing()).execute()
      counts.legacyKeys++
    }
  }
  if (counts.datesSkipped) warnings.push(`${counts.datesSkipped} picked prayer times in campaigns without 24/7 coverage were not imported`)
  return { counts, news, warnings, names, emails }
}

export async function grantNews(tx: Tx, requests: NewsRequest[]): Promise<number> {
  let granted = 0
  for (const r of requests) {
    const contact = await upsertContact(tx, { email: r.email, name: r.name, source: IMPORT_SOURCE })
    const ok = await setConsent(tx, contact.channelId, PURPOSE_PLATFORM_NEWS, true, { wording: { key: 'consent.platform_news' }, surface: 'wordpress_import', source: IMPORT_SOURCE })
    if (ok) granted++
    const account = await accountByEmail(tx, r.email)
    if (account?.verified) await linkContactToAccount(tx, contact.contactId, account)
  }
  return granted
}
