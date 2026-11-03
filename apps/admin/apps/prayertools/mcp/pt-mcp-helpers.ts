// Shared pieces of the prayer.tools MCP tools: the org and block inputs, the
// site transaction wrapper, content conversion and admin links.
import { z } from 'zod'
import type { Transaction } from 'kysely'
import { createError } from 'h3'
import { mcpError, mcpLog, type McpToolContext, type McpToolResult } from '#mcp-layer'
import { withOrgPermission, type TenantContext } from '#tenant/server'
import type { Database } from '#core/server/database/schema'
import type { Permission } from '#core/app/utils/permissions'
import { blocksToDoc, CONTENT_BLOCKS_HELP, ContentBlocksError, docToBlocks, type ContentBlock } from '@prayertools/shared/content-blocks'
import { platformConfig } from '@prayertools/shared/config'
import { setText, textIn } from '@prayertools/shared/translatable'
import type { TiptapDoc, TranslatableText } from '@prayertools/shared/db/schema'
import { ptAdminDb } from '../server/utils/pt-context'

export type Tx = Transaction<Database>

export const SITE_APP = 'site'

export const CONTENT_GUIDANCE = 'Prayer content should be biblical and strategic, so it builds up the people who pray it as well as praying for the place.'

export const orgInput = z.string().min(1).max(64).optional()
  .describe('Site slug from list_orgs. Defaults to the X-Active-Org header, else your only site.')

export const langInput = z.string().regex(/^[a-z]{2,3}(-[a-z]{2,4})?$/).optional()
  .describe('Language code of the text. Defaults to the site\'s default language.')

export const idInput = (what: string) => z.string().uuid().describe(what)

const inline = z.string().max(20_000)
const align = z.enum(['center', 'right', 'justify']).optional()

export const blockInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: inline, align }).strict(),
  z.object({ type: z.literal('heading'), level: z.number().int().min(1).max(6).default(2), text: inline, align }).strict(),
  z.object({ type: z.literal('list'), ordered: z.boolean().optional(), items: z.array(inline).min(1).max(100) }).strict(),
  z.object({ type: z.literal('quote'), text: inline }).strict(),
  z.object({ type: z.literal('verse'), reference: z.string().min(1).max(120), translation: z.string().max(40).optional(), text: inline }).strict(),
  z.object({
    type: z.literal('image'),
    src: z.string().url().optional().describe('Image URL. Use assetId for an image from list_images instead.'),
    assetId: z.string().uuid().optional().describe('An image from list_images; its alt text is used when alt is left out.'),
    alt: z.string().max(500).optional(),
    width: z.number().int().positive().max(4000).optional()
  }).strict(),
  z.object({ type: z.literal('video'), url: z.string().url() }).strict(),
  z.object({ type: z.literal('button'), label: z.string().min(1).max(120), url: z.string().max(2000) }).strict(),
  z.object({ type: z.literal('divider') }).strict()
])

export type BlockInput = z.input<typeof blockInput>

export const blocksInput = z.array(blockInput).max(300).describe(CONTENT_BLOCKS_HELP)

export function result(text: string, structured: Record<string, unknown>): McpToolResult<Record<string, unknown>> {
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

// Runs a tool body and maps thrown errors to an MCP error result.
export async function run(fn: () => Promise<McpToolResult<Record<string, unknown>>>): Promise<McpToolResult<Record<string, unknown>>> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ContentBlocksError) return mcpError(createError({ statusCode: 400, statusMessage: err.message }))
    return mcpError(err)
  }
}

// The tool's site transaction: the token must carry `perm` and the user must
// hold it in the site.
export function inSite<T>(ctx: McpToolContext, org: string | undefined, perm: Permission, fn: (tx: Tx, tenant: TenantContext) => Promise<T>): Promise<T> {
  return withOrgPermission(ctx.event, { appId: SITE_APP, org }, perm, fn)
}

export async function audit(ctx: McpToolContext, tx: Tx, event: 'CREATE' | 'UPDATE' | 'DELETE', table: string, recordId: string, changes: Record<string, unknown> = {}) {
  await mcpLog(event, table, recordId, ctx, changes, tx)
}

export function adminLink(orgSlug: string | null, path: string): string {
  return `${platformConfig().adminUrl}${orgSlug ? `/@${orgSlug}` : ''}${path}`
}

// Blocks to a Tiptap doc. Image blocks naming an assetId take that image's
// URL (and alt text, unless given) from the caller's image library.
export async function blocksDoc(userId: string, lang: string, blocks: BlockInput[]): Promise<TiptapDoc> {
  const ids = [...new Set(blocks.flatMap(b => b.type === 'image' && b.assetId && !b.src ? [b.assetId] : []))]
  const assets = ids.length
    ? await ptAdminDb().selectFrom('pt_personal_asset').select(['id', 'url', 'alt']).where('owner_user_id', '=', userId).where('id', 'in', ids).execute()
    : []
  const resolved: ContentBlock[] = blocks.map((b, i) => {
    if (b.type === 'heading') return { ...b, level: b.level ?? 2 }
    if (b.type !== 'image') return b
    const asset = b.assetId ? assets.find(a => a.id === b.assetId) : undefined
    if (b.assetId && !b.src && !asset) throw new ContentBlocksError(`blocks[${i}]: image ${b.assetId} is not in your image library`)
    const src = b.src ?? asset?.url ?? ''
    const alt = b.alt ?? (asset ? textIn(asset.alt as TranslatableText, lang) : '')
    return { type: 'image', src, alt, ...(b.width ? { width: b.width } : {}) }
  })
  return blocksToDoc(resolved)
}

export function docBlocks(doc: TiptapDoc | null | undefined) {
  return docToBlocks(doc)
}

export const INEXACT_NOTE = 'Some of this content uses formatting blocks can\'t express (marked exact: false); writing those days back replaces that formatting with the nearest blocks.'

// `value` written in `lang` onto the current translatable text: writing the
// source language marks the other languages out of date.
export function withText(current: TranslatableText | null | undefined, lang: string, value: string): TranslatableText {
  return setText(current, lang, value)
}

export async function siteLanguage(tx: Tx, lang: string | undefined): Promise<{ lang: string, languages: string[], defaultLanguage: string }> {
  const site = await tx.selectFrom('pt_site').select(['languages', 'default_language']).executeTakeFirst()
  if (!site) throw createError({ statusCode: 404, statusMessage: 'This organization is not a site.' })
  const chosen = lang ?? site.default_language
  if (!site.languages.includes(chosen)) throw createError({ statusCode: 400, statusMessage: `${chosen} is not one of this site's languages (${site.languages.join(', ')}).` })
  return { lang: chosen, languages: site.languages, defaultLanguage: site.default_language }
}
