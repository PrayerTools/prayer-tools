// MCP tools for prayer content: the library catalog, the libraries stacked on
// a campaign, reading, writing and translating a site's content days, the
// champion's own libraries, and their image library.
import { z } from 'zod'
import { sql } from 'kysely'
import { createError } from 'h3'
import { defineMcpTool, mcpLog } from '#mcp-layer'
import { db } from '#core/server/utils/database'
import { runInUserTransaction } from '#core/server/utils/personal-apps'
import { LICENSES } from '@prayertools/shared/content'
import { PT_LIBRARY_APP } from '@prayertools/shared/site'
import { rateLimit } from '@prayertools/shared/rate-limit'
import { jsonb } from '@prayertools/shared/db/json'
import { textIn } from '@prayertools/shared/translatable'
import type { TiptapDoc, TranslatableText } from '@prayertools/shared/db/schema'
import { ptSite, ptTx } from '../server/utils/pt-context'
import { ptAddCampaignContent, ptCampaignLibraries, ptSaveSiteEntry, ptSiteEntry, ptSiteLibrary } from '../server/utils/pt-content'
import { ptLibraryEditableBy, ptLibraryMeta, ptSaveLibraryDraft } from '../server/utils/pt-libraries'
import { ptTranslate } from '../server/utils/pt-translate'
import { ptProcessImage } from '../server/utils/pt-images'
import { ptFetchImage } from '../server/utils/pt-fetch-image'
import { adminLink, audit, blocksDoc, blocksInput, CONTENT_GUIDANCE, docBlocks, idInput, INEXACT_NOTE, inSite, langInput, orgInput, result, run, siteLanguage, SITE_APP, withText } from './pt-mcp-helpers'

const MAX_DAYS = 31
const MAX_TRANSLATIONS = 10
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

const languageCode = z.string().regex(/^[a-z]{2,3}(-[a-z]{2,4})?$/)
const dayInput = z.number().int().min(1).max(3650)

const searchLibrariesTool = defineMcpTool({
  name: 'search_libraries',
  title: 'Search Prayer Libraries',
  description: 'Search the library catalog: reusable prayer content curated by Prayer.Tools and shared by champions, plus your own libraries. A campaign can follow a library (fixes and new translations arrive automatically) or the site can edit its own copy.',
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({
    query: z.string().max(200).optional().describe('Matches title and description.'),
    cadence: z.enum(['daily', 'weekly']).optional(),
    language: languageCode.optional(),
    topic: z.string().max(60).optional().describe('E.g. "ramadan", "crisis".'),
    template: z.string().max(60).optional().describe('A campaign template key; libraries linked to it come first.'),
    mine: z.boolean().default(false).describe('Only your own libraries, including unpublished ones.')
  }).strict(),
  handler: (input, ctx) => run(async () => {
    const userId = ctx.auth.userId
    let q = db.selectFrom('pt_library').select([
      'id', 'owner_user_id', 'title', 'description', 'cadence', 'entry_count', 'languages', 'source_language', 'topics', 'template_keys',
      'license', 'credit', 'visibility', 'published_version'
    ])
    if (input.mine) q = q.where('owner_user_id', '=', userId)
    else q = q.where(eb => eb.or([eb('visibility', '=', 'published'), eb('owner_user_id', '=', userId)])).where('published_version', '>', 0)
    if (input.cadence) q = q.where('cadence', '=', input.cadence)
    if (input.language) q = q.where(sql<boolean>`${input.language} = ANY(languages)`)
    if (input.topic) q = q.where(sql<boolean>`${input.topic} = ANY(topics)`)
    if (input.query?.trim()) q = q.where(eb => eb.or([eb('title', 'ilike', `%${input.query}%`), eb('description', 'ilike', `%${input.query}%`)]))
    const rows = await q.orderBy('title').limit(50).execute()
    const libraries = rows.map(({ owner_user_id, ...r }) => ({
      ...r,
      mine: owner_user_id === userId,
      platform: owner_user_id === null,
      suggested: !!input.template && r.template_keys.includes(input.template)
    }))
    if (input.template) libraries.sort((a, b) => Number(b.suggested) - Number(a.suggested))
    return result(`${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'}.`, { libraries })
  })
})

const getLibraryTool = defineMcpTool({
  name: 'get_library',
  title: 'Get Prayer Library',
  description: 'A library\'s details and the content of a range of its days in one language, as blocks: the published text, or for your own library its draft.',
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({
    library: idInput('Library id from search_libraries.'),
    language: languageCode.optional().describe('Defaults to the library\'s source language.'),
    from_day: dayInput.default(1),
    to_day: dayInput.optional().describe(`At most ${MAX_DAYS} days per call; defaults to from_day + 6.`)
  }).strict(),
  handler: (input, ctx) => run(async () => {
    const lib = await db.selectFrom('pt_library').selectAll().where('id', '=', input.library).executeTakeFirst()
    const own = lib?.owner_user_id === ctx.auth.userId
    if (!lib || (!own && lib.visibility !== 'published')) throw createError({ statusCode: 404, statusMessage: 'Library not found.' })
    const lang = input.language ?? lib.source_language
    const from = input.from_day ?? 1
    const to = Math.min(input.to_day ?? from + 6, from + MAX_DAYS - 1)
    const entries = await db.selectFrom('pt_library_entry').select(['day', 'draft', 'published'])
      .where('library_id', '=', lib.id).where('language', '=', lang).where('day', '>=', from).where('day', '<=', to)
      .orderBy('day').execute()
    const days = entries.flatMap((e) => {
      const doc = (own ? e.draft : e.published) as TiptapDoc | null
      if (!doc) return []
      const { blocks, exact } = docBlocks(doc)
      return [{ day: e.day, blocks, exact, ...(own ? { published: JSON.stringify(e.draft) === JSON.stringify(e.published) } : {}) }]
    })
    const { owner_user_id, ...meta } = lib
    return result(`${lib.title}: days ${from}–${to} in ${lang}${days.some(d => !d.exact) ? `. ${INEXACT_NOTE}` : '.'}`, {
      library: { ...meta, mine: own, platform: owner_user_id === null },
      language: lang,
      days
    })
  })
})

const campaignContentTool = defineMcpTool({
  name: 'get_campaign_content',
  title: 'Get Campaign Content',
  description: 'The content libraries stacked on a campaign (shown together each day, in order), with entry counts, which days exist and are out of date in each language, and whether the site follows a library or has its own copy. Use a library\'s `id` (the site library id) with read_content and write_content.',
  appId: SITE_APP,
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({ org: orgInput, campaign: idInput('Campaign id from get_site_overview.') }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.read', async (tx, tenant) => {
    const site = await ptSite(tx)
    const libraries = await ptCampaignLibraries(tx, input.campaign, site.languages)
    return result(`${libraries.length} content librar${libraries.length === 1 ? 'y' : 'ies'} on this campaign.`, {
      languages: site.languages,
      defaultLanguage: site.default_language,
      libraries,
      adminUrl: adminLink(tenant.orgSlug, '/site/content')
    })
  }))
})

const addContentTool = defineMcpTool({
  name: 'add_campaign_content',
  title: 'Add Campaign Content',
  description: 'Stack content on a campaign: a library from search_libraries, which the site follows until it edits it, or (without library) a new empty site library to write with write_content. Returns the site library id.',
  appId: SITE_APP,
  scope: 'pt.content.write',
  input: z.object({
    org: orgInput,
    campaign: idInput('Campaign id from get_site_overview.'),
    library: idInput('Library id from search_libraries.').optional(),
    title: z.string().max(120).optional().describe('Title of a new site library.'),
    cadence: z.enum(['daily', 'weekly']).optional().describe('Cadence of a new site library; defaults to the campaign\'s.')
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.content.write', async (tx, tenant) => {
    const { siteLibraryId } = await ptAddCampaignContent(tx, tenant, { campaignId: input.campaign, libraryId: input.library, title: input.title, cadence: input.cadence })
    await audit(ctx, tx, 'CREATE', 'pt_campaign_library', siteLibraryId, { campaign: input.campaign, library: input.library ?? null })
    return result(input.library ? 'Library added; the site follows it.' : `New site library added. ${CONTENT_GUIDANCE}`, { siteLibraryId })
  }))
})

const removeContentTool = defineMcpTool({
  name: 'remove_campaign_content',
  title: 'Remove Campaign Content',
  description: 'Take a library off a campaign. The site keeps its copy and edits, so adding it again brings them back.',
  appId: SITE_APP,
  scope: 'pt.content.write',
  destructive: true,
  input: z.object({ org: orgInput, campaign: idInput('Campaign id.'), site_library: idInput('Site library id from get_campaign_content.') }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.content.write', async (tx) => {
    const res = await tx.deleteFrom('pt_campaign_library').where('site_library_id', '=', input.site_library).where('campaign_id', '=', input.campaign).executeTakeFirst()
    if (!Number(res.numDeletedRows)) throw createError({ statusCode: 404, statusMessage: 'That library is not on this campaign.' })
    await audit(ctx, tx, 'DELETE', 'pt_campaign_library', input.site_library, { campaign: input.campaign })
    return result('Removed from the campaign.', { ok: true })
  }))
})

const reorderContentTool = defineMcpTool({
  name: 'reorder_campaign_content',
  title: 'Reorder Campaign Content',
  description: 'Set the order the campaign\'s libraries show in each day.',
  appId: SITE_APP,
  scope: 'pt.content.write',
  input: z.object({
    org: orgInput,
    campaign: idInput('Campaign id.'),
    site_libraries: z.array(z.string().uuid()).min(1).max(20).describe('Every site library id on the campaign, in the new order.')
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.content.write', async (tx) => {
    for (const [i, id] of input.site_libraries.entries()) {
      await tx.updateTable('pt_campaign_library').set({ position: i }).where('campaign_id', '=', input.campaign).where('site_library_id', '=', id).execute()
    }
    await audit(ctx, tx, 'UPDATE', 'pt_campaign', input.campaign, { order: input.site_libraries })
    return result('Order saved.', { ok: true })
  }))
})

function dayRange(from: number, to: number | undefined): number[] {
  const last = Math.min(to ?? from, from + MAX_DAYS - 1)
  if (last < from) throw createError({ statusCode: 400, statusMessage: 'to_day comes before from_day.' })
  return Array.from({ length: last - from + 1 }, (_, i) => from + i)
}

const readContentTool = defineMcpTool({
  name: 'read_content',
  title: 'Read Content',
  description: `A range of days of one of a site's content libraries in one language, as blocks. At most ${MAX_DAYS} days per call. Days marked stale are out of date with the default language.`,
  appId: SITE_APP,
  scope: 'pt.site.read',
  readOnly: true,
  input: z.object({
    org: orgInput,
    site_library: idInput('Site library id from get_campaign_content.'),
    language: langInput,
    from_day: dayInput.default(1),
    to_day: dayInput.optional()
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.site.read', async (tx) => {
    const { lang } = await siteLanguage(tx, input.language)
    const sl = await ptSiteLibrary(tx, input.site_library)
    const days = []
    for (const day of dayRange(input.from_day ?? 1, input.to_day ?? (input.from_day ?? 1) + 6)) {
      const e = await ptSiteEntry(tx, sl.id, day, lang)
      if (!e.doc) continue
      const { blocks, exact } = docBlocks(e.doc)
      days.push({ day, blocks, exact, stale: e.stale })
    }
    const follows = !!sl.library_id && sl.frozen_version === null
    return result(
      `${sl.title}: ${days.length} day(s) in ${lang}${follows ? ' (followed library: writing a day gives the site its own copy)' : ''}${days.some(d => !d.exact) ? `. ${INEXACT_NOTE}` : '.'}`,
      { siteLibrary: { id: sl.id, title: sl.title, cadence: sl.cadence, follows }, language: lang, days }
    )
  }))
})

const writeDaysInput = z.array(z.object({ day: dayInput, blocks: blocksInput }).strict()).min(1).max(MAX_DAYS)

const writeContentTool = defineMcpTool({
  name: 'write_content',
  title: 'Write Content',
  description: `Write days of a site's content library in one language (at most ${MAX_DAYS} per call), replacing those days. Writing the default language needs content-edit permission and marks the day's other languages out of date; other languages need translate permission. If the site follows a catalog library, the first write gives the site its own frozen copy, so later updates to that library no longer arrive. ${CONTENT_GUIDANCE}`,
  appId: SITE_APP,
  scope: 'pt.content.translate',
  input: z.object({
    org: orgInput,
    site_library: idInput('Site library id from get_campaign_content.'),
    language: langInput,
    days: writeDaysInput
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.content.translate', async (tx, tenant) => {
    const { lang } = await siteLanguage(tx, input.language)
    const sl = await ptSiteLibrary(tx, input.site_library)
    const froze = !!sl.library_id && sl.frozen_version === null
    for (const d of input.days) {
      const doc = await blocksDoc(ctx.auth.userId, lang, d.blocks)
      await ptSaveSiteEntry(tx, tenant, { siteLibraryId: sl.id, day: d.day, lang, doc })
    }
    await audit(ctx, tx, 'UPDATE', 'pt_site_entry', sl.id, { language: lang, days: input.days.map(d => d.day) })
    return result(
      `Saved ${input.days.length} day(s) in ${lang}.${froze ? ' The site now has its own copy of this library; updates to the catalog library no longer reach it.' : ''}`,
      { ok: true, frozeCopy: froze, adminUrl: adminLink(tenant.orgSlug, '/site/content') }
    )
  }))
})

const translateContentTool = defineMcpTool({
  name: 'translate_content',
  title: 'Translate Content',
  description: `Translate days of a site's content library from the default language with the site's AI translation and save them. Scripture verses are kept as they are. By default only days that are missing or out of date in a target language are translated. At most ${MAX_TRANSLATIONS} day × language translations per call.`,
  appId: SITE_APP,
  scope: 'pt.content.translate',
  input: z.object({
    org: orgInput,
    site_library: idInput('Site library id from get_campaign_content.'),
    languages: z.array(languageCode).min(1).max(10).optional().describe('Target languages; defaults to every site language but the default.'),
    from_day: dayInput.default(1),
    to_day: dayInput.optional(),
    overwrite: z.boolean().default(false).describe('Also retranslate days that are up to date.')
  }).strict(),
  handler: (input, ctx) => run(() => inSite(ctx, input.org, 'pt.content.translate', async (tx, tenant) => {
    const { languages, defaultLanguage } = await siteLanguage(tx, undefined)
    const targets = (input.languages ?? languages).filter(l => l !== defaultLanguage)
    const bad = targets.filter(l => !languages.includes(l))
    if (bad.length) throw createError({ statusCode: 400, statusMessage: `Not site languages: ${bad.join(', ')}.` })
    const sl = await ptSiteLibrary(tx, input.site_library)
    const done: { day: number, language: string }[] = []
    let remaining = 0
    for (const day of dayRange(input.from_day ?? 1, input.to_day ?? (input.from_day ?? 1) + MAX_DAYS - 1)) {
      const source = await ptSiteEntry(tx, sl.id, day, defaultLanguage)
      if (!source.doc) continue
      for (const to of targets) {
        const current = await ptSiteEntry(tx, sl.id, day, to)
        if (current.doc && !current.stale && !input.overwrite) continue
        if (done.length >= MAX_TRANSLATIONS) {
          remaining++
          continue
        }
        const { doc } = await ptTranslate(tx, { doc: source.doc, from: defaultLanguage, to })
        await ptSaveSiteEntry(tx, tenant, { siteLibraryId: sl.id, day, lang: to, doc })
        done.push({ day, language: to })
      }
    }
    if (done.length) await audit(ctx, tx, 'UPDATE', 'pt_site_entry', sl.id, { translated: done })
    return result(
      `Translated ${done.length} day × language pair(s).${remaining ? ` ${remaining} more need translating; call again to continue.` : ''} Ask the champion to review the translations.`,
      { translated: done, remaining }
    )
  }))
})

const createLibraryTool = defineMcpTool({
  name: 'create_library',
  title: 'Create Prayer Library',
  description: 'Create one of your own prayer libraries: reusable content you can use on any of your sites. It stays private to you; sharing it with everyone happens in the admin. Write its days with write_library_entries.',
  scope: 'pt.library.write',
  input: z.object({
    title: z.string().min(2).max(120),
    description: z.string().max(2000).optional(),
    cadence: z.enum(['daily', 'weekly']).default('daily'),
    source_language: languageCode.describe('The language the library is written in.'),
    license: z.enum(LICENSES).describe('"own": you wrote it; "permission": used with permission; "cc_by" / "cc_by_sa": Creative Commons; "other".'),
    credit: z.string().max(200).optional().describe('Credit line shown under the content.'),
    topics: z.array(z.string().max(40)).max(12).optional()
  }).strict(),
  handler: (input, ctx) => run(async () => {
    const meta = ptLibraryMeta(input as Record<string, unknown>)
    const row = await db.insertInto('pt_library').values({ ...meta, owner_user_id: ctx.auth.userId, visibility: 'private' } as never).returning('id').executeTakeFirstOrThrow()
    await mcpLog('CREATE', 'pt_library', row.id, ctx, { title: input.title })
    return result(`Created the library "${input.title}". ${CONTENT_GUIDANCE}`, { id: row.id, adminUrl: adminLink(null, `/libraries/${row.id}`) })
  })
})

const writeLibraryTool = defineMcpTool({
  name: 'write_library_entries',
  title: 'Write Library Entries',
  description: `Write days of one of your own libraries in one language (at most ${MAX_DAYS} per call) as drafts. Drafts reach sites only when you publish the library in the admin. ${CONTENT_GUIDANCE}`,
  scope: 'pt.library.write',
  input: z.object({
    library: idInput('Your library\'s id.'),
    language: languageCode,
    days: writeDaysInput
  }).strict(),
  handler: (input, ctx) => run(async () => {
    await ptLibraryEditableBy({ userId: ctx.auth.userId, isAdmin: false }, input.library)
    for (const d of input.days) {
      const doc = await blocksDoc(ctx.auth.userId, input.language, d.blocks)
      await ptSaveLibraryDraft(input.library, d.day, input.language, doc)
    }
    await mcpLog('UPDATE', 'pt_library', input.library, ctx, { language: input.language, days: input.days.map(d => d.day) })
    return result(`Saved ${input.days.length} draft day(s). Publish the library in the admin when it is ready.`, { ok: true, adminUrl: adminLink(null, `/libraries/${input.library}`) })
  })
})

const listImagesTool = defineMcpTool({
  name: 'list_images',
  title: 'List Images',
  description: 'Images in your image library, usable on any of your sites: pass an id as an image block\'s assetId, or use its url.',
  scope: 'pt.library.write',
  readOnly: true,
  input: z.object({ language: languageCode.default('en').describe('Language of the alt text returned.') }).strict(),
  handler: (input, ctx) => run(async () => {
    const userId = ctx.auth.userId
    const rows = await runInUserTransaction(userId, { appId: PT_LIBRARY_APP }, tx => ptTx(tx).selectFrom('pt_personal_asset')
      .select(['id', 'url', 'url_small', 'width', 'height', 'alt', 'credit', 'created_at'])
      .where('owner_user_id', '=', userId).orderBy('created_at', 'desc').limit(200).execute())
    const images = rows.map(r => ({ ...r, alt: textIn(r.alt as TranslatableText, input.language ?? 'en') }))
    return result(`${images.length} image(s).`, { images })
  })
})

const addImageTool = defineMcpTool({
  name: 'add_image_from_url',
  title: 'Add Image From URL',
  description: 'Download a JPEG, PNG, WebP, GIF or AVIF image (up to 12 MB) from a public URL into your image library. Use only images the champion has the right to use, and describe them for people who can\'t see them.',
  scope: 'pt.library.write',
  input: z.object({
    url: z.string().url(),
    alt: z.string().min(1).max(500).describe('What the image shows, for people who can\'t see it.'),
    language: languageCode.default('en').describe('Language of the alt text.'),
    credit: z.string().max(200).optional().describe('Photographer or source.')
  }).strict(),
  handler: (input, ctx) => run(async () => {
    const userId = ctx.auth.userId
    if (!rateLimit(`upload:${userId}`, 60, 3600_000).ok) throw createError({ statusCode: 429, statusMessage: 'Too many uploads. Try again later.' })
    const { data } = await ptFetchImage(input.url, MAX_IMAGE_BYTES)
    const img = await ptProcessImage(data)
    const row = await runInUserTransaction(userId, { appId: PT_LIBRARY_APP }, tx => ptTx(tx).insertInto('pt_personal_asset').values({
      owner_user_id: userId,
      storage_key: img.key,
      url: img.url,
      url_small: img.urlSmall,
      content_type: 'image/webp',
      width: img.width,
      height: img.height,
      alt: jsonb(withText(null, input.language ?? 'en', input.alt.trim())),
      credit: input.credit?.trim() || null
    } as never).returning(['id', 'url']).executeTakeFirstOrThrow())
    await mcpLog('CREATE', 'pt_personal_asset', row.id, ctx, { source: input.url })
    return result('Image added to your library.', { id: row.id, url: row.url })
  })
})

export const contentTools = [
  searchLibrariesTool,
  getLibraryTool,
  campaignContentTool,
  addContentTool,
  removeContentTool,
  reorderContentTool,
  readContentTool,
  writeContentTool,
  translateContentTool,
  createLibraryTool,
  writeLibraryTool,
  listImagesTool,
  addImageTool
]
