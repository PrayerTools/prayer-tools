// AI help with a campaign's prayer content: drafts from field reports, a
// series of drafts, a sensitive-details check and a review. Every result is
// returned for the champion to review; nothing is saved here.
import { sql, type Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import type { TenantContext } from '#tenant/server'
import { generate, isAiConfigured } from '#ai/server'
import { rateLimit } from '@prayertools/shared/rate-limit'
import { getLanguage } from '@prayertools/shared/languages'
import type { TiptapDoc } from '@prayertools/shared/db/schema'
import {
  DRAFT_TOOL, MAX_REPORTS_CHARS, MAX_SERIES, PRAYER_AI_FEATURES, REVIEW_TOOL, SENSITIVE_TOOL, SERIES_TOOL,
  cleanReports, draftPrompt, draftToDoc, entryText, parseDraftEntry, parseReview, parseSensitive, parseSeries,
  reviewPrompt, sensitivePrompt, seriesPrompt,
  type AiPrompt, type AiTool, type DraftEntry, type EntryReview, type PrayerAiContext, type PrayerAiFeature, type SensitiveFinding, type VerseText
} from '@prayertools/shared/prayer-ai'

type Tx = Transaction<Database>

// Request body fields: campaignId, siteLibraryId, day, lang, reports,
// translation, count, doc.
type PtAiInput = Record<string, unknown>

const SAMPLE_CHARS = 1500

async function run<T>(tx: Tx, ctx: TenantContext, feature: PrayerAiFeature, prompt: AiPrompt, tool: AiTool, opts: { temperature: number, maxTokens?: number }): Promise<T> {
  if (!(await isAiConfigured(tx))) throw createError({ statusCode: 409, statusMessage: 'AI help is not set up. An operator can add a key in Admin → AI, or an owner in the site\'s AI settings.' })
  const f = PRAYER_AI_FEATURES[feature]
  const limit = rateLimit(`ai:${f.key}:${ctx.orgId}`, f.perHour, 3600_000)
  if (!limit.ok) throw createError({ statusCode: 429, statusMessage: `This site has used this AI help ${f.perHour} times in the last hour. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` })
  const result = await generate<T>({
    tx,
    feature: f.key,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    tool,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens
  })
  return result.input
}

// Campaign, language and the voice of entries already written in the section.
async function aiContext(tx: Tx, ctx: TenantContext, b: PtAiInput, skipDays: number[] = []): Promise<PrayerAiContext> {
  const site = await ptSite(tx)
  const lang = String(b.lang || site.default_language)
  if (!site.languages.includes(lang)) ptBadRequest('Not a site language.')
  const campaign = b.campaignId
    ? await tx.selectFrom('pt_campaign').select(['name', 'place_name', 'people_group', 'cadence']).where('id', '=', String(b.campaignId)).executeTakeFirst()
    : undefined
  if (b.campaignId && !campaign) ptNotFound('Campaign not found.')
  return {
    language: getLanguage(lang)?.name ?? lang,
    siteName: ctx.orgName,
    campaignName: campaign?.name ?? ctx.orgName,
    place: campaign?.place_name ?? null,
    peopleGroup: campaign?.people_group ?? null,
    cadence: campaign?.cadence === 'weekly' ? 'weekly' : 'daily',
    samples: b.siteLibraryId ? await voiceSamples(tx, String(b.siteLibraryId), lang, Number(b.day) || 1, skipDays) : []
  }
}

async function voiceSamples(tx: Tx, siteLibraryId: string, lang: string, day: number, skipDays: number[]): Promise<string[]> {
  const sl = await ptSiteLibrary(tx, siteLibraryId)
  const follows = !!sl.library_id && sl.frozen_version === null
  const nearest = sql`abs(day - ${day})`
  const skip = skipDays.length ? skipDays : [0]
  const rows = follows
    ? await tx.selectFrom('pt_library_entry').select(['published as doc']).where('library_id', '=', sl.library_id!).where('language', '=', lang).where('published', 'is not', null).where('day', 'not in', skip).orderBy(nearest).limit(2).execute()
    : await tx.selectFrom('pt_site_entry').select(['content as doc']).where('site_library_id', '=', sl.id).where('language', '=', lang).where('day', 'not in', skip).orderBy(nearest).limit(2).execute()
  return rows.map(r => entryText(r.doc as TiptapDoc, false).slice(0, SAMPLE_CHARS)).filter(Boolean)
}

function reportsFrom(b: PtAiInput): string[] {
  const reports = cleanReports(b.reports)
  if (!reports.length) ptBadRequest('Paste at least one report.')
  if (reports.join('').length > MAX_REPORTS_CHARS) ptBadRequest('The reports are too long. Paste less at once.')
  return reports
}

// Looks up every suggested reference through bolls.life; a failed lookup
// leaves that reference unresolved.
async function resolveVerses(entries: DraftEntry[], translation: string): Promise<{ verses: Record<string, VerseText | null>, unresolved: string[] }> {
  const refs = [...new Set(entries.flatMap(e => e.scripture.map(s => s.reference)))]
  const chapters = new Map()
  const found = await Promise.all(refs.map(ref => ptLookupScripture(ref, translation, chapters).catch(() => null)))
  const verses = Object.fromEntries(refs.map((ref, i) => [ref, found[i] ?? null]))
  return { verses, unresolved: refs.filter((_, i) => !found[i]) }
}

export async function ptAiDraft(tx: Tx, ctx: TenantContext, b: PtAiInput): Promise<{ doc: TiptapDoc, unresolved: string[] }> {
  const reports = reportsFrom(b)
  const aiCtx = await aiContext(tx, ctx, b, [Number(b.day)])
  const input = await run<unknown>(tx, ctx, 'draft', draftPrompt(aiCtx, reports), DRAFT_TOOL, { temperature: 0.5 })
  const entry = parseDraftEntry(input)
  if (!entry) throw createError({ statusCode: 502, statusMessage: 'The draft came back incomplete. Please try again.' })
  const { verses, unresolved } = await resolveVerses([entry], ptBibleTranslation(b.translation))
  return { doc: draftToDoc(entry, verses), unresolved }
}

export async function ptAiSeries(tx: Tx, ctx: TenantContext, b: PtAiInput): Promise<{ drafts: { day: number, doc: TiptapDoc }[], unresolved: string[] }> {
  const reports = reportsFrom(b)
  const count = Number(b.count ?? 7)
  const day = Number(b.day)
  if (!Number.isInteger(count) || count < 2 || count > MAX_SERIES) ptBadRequest(`A series has 2 to ${MAX_SERIES} entries.`)
  if (!Number.isInteger(day) || day < 1 || day > 3650) ptBadRequest('Invalid day.')
  const days = Array.from({ length: count }, (_, i) => day + i)
  const aiCtx = await aiContext(tx, ctx, b, days)
  const input = await run<unknown>(tx, ctx, 'series', seriesPrompt(aiCtx, reports, count), SERIES_TOOL, { temperature: 0.5, maxTokens: 16_000 })
  const entries = parseSeries(input, count)
  if (!entries.length) throw createError({ statusCode: 502, statusMessage: 'The series came back incomplete. Please try again.' })
  const { verses, unresolved } = await resolveVerses(entries, ptBibleTranslation(b.translation))
  return { drafts: entries.map((e, i) => ({ day: day + i, doc: draftToDoc(e, verses) })), unresolved }
}

export async function ptAiSensitive(tx: Tx, ctx: TenantContext, b: PtAiInput): Promise<{ findings: SensitiveFinding[] }> {
  const text = entryText(ptDoc(b.doc), false)
  if (!text.trim()) return { findings: [] }
  const aiCtx = await aiContext(tx, ctx, { ...b, siteLibraryId: undefined })
  const input = await run<unknown>(tx, ctx, 'sensitive', sensitivePrompt(aiCtx, text), SENSITIVE_TOOL, { temperature: 0.1 })
  return { findings: parseSensitive(input, text) }
}

export async function ptAiReview(tx: Tx, ctx: TenantContext, b: PtAiInput): Promise<{ review: EntryReview }> {
  const text = entryText(ptDoc(b.doc), true)
  if (!text.trim()) ptBadRequest('Write something to review first.')
  const aiCtx = await aiContext(tx, ctx, { ...b, siteLibraryId: undefined })
  const input = await run<unknown>(tx, ctx, 'review', reviewPrompt(aiCtx, text), REVIEW_TOOL, { temperature: 0.3 })
  const review = parseReview(input, text)
  if (!review) throw createError({ statusCode: 502, statusMessage: 'The review came back incomplete. Please try again.' })
  return { review }
}
