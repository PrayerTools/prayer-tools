// MCP tools for site email: audiences, listing and reading emails, and saving
// drafts for one site or for several sites at once. Sending, scheduling and
// test sends stay in the admin, so a person reviews every email first.
// Registered by modules/marketing-mcp.ts only when the MCP layer is loaded.
//
// Email bodies use the host's `mcpContent` format when it has one, Tiptap
// JSON otherwise.
import { z } from 'zod'
import { sql } from 'kysely'
import { createError } from 'h3'
import { defineMcpTool, mcpError, mcpLog, type McpToolResult } from '#mcp-layer'
import { withOrgPermission } from '#tenant/server'
import { runInUserTransaction } from '#core/server/utils/personal-apps'
import { audienceCounts } from '../lib/audiences'
import type { EmailVersions, TiptapDoc } from '../lib/types'
import {
  marketingCreateDraft,
  marketingCreateParentDraft,
  marketingHost,
  marketingSendableSites,
  marketingTx,
  marketingUpdateDraft,
  marketingUpdateParentDraft
} from '../server/utils/marketing-api'

const APP = 'marketing'

const orgInput = z.string().min(1).max(64).optional()
  .describe('Org slug from list_orgs. Defaults to the X-Active-Org header, else your only org.')

const languageCode = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/)

const versionInput = z.object({
  language: languageCode,
  subject: z.string().min(1).max(200),
  preheader: z.string().max(200).optional().describe('Preview text shown after the subject in inboxes.'),
  content: z.array(z.record(z.unknown())).max(300).describe('The email body; see the tool description for the format.')
}).strict()

const draftFields = {
  source_language: languageCode.describe('The language the email is written in first; it needs a version.'),
  versions: z.array(versionInput).min(1).max(10).describe('One version per language.'),
  audiences: z.array(z.string().max(80)).max(20).describe('Audience keys from email_list_audiences.')
}

function result(text: string, structured: Record<string, unknown>): McpToolResult<Record<string, unknown>> {
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

async function run(fn: () => Promise<McpToolResult<Record<string, unknown>>>): Promise<McpToolResult<Record<string, unknown>>> {
  try {
    return await fn()
  } catch (err) {
    return mcpError(err)
  }
}

function formatHelp(): string {
  const host = marketingHost()
  const vars = host.variableList.map(v => `{${v.key}}`).join(', ')
  const format = host.mcpContent?.help ?? 'Content is Tiptap JSON: an array of the doc\'s top-level nodes.'
  return `${format} Placeholders fill in per recipient: ${vars}.`
}

function toDoc(content: Record<string, unknown>[]): TiptapDoc {
  const host = marketingHost()
  if (!host.mcpContent) return { type: 'doc', content: content as unknown as TiptapDoc['content'] }
  try {
    return host.mcpContent.toDoc(content)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message || 'Invalid content.' })
  }
}

function fromDoc(doc: TiptapDoc): { content: unknown[], exact: boolean } {
  const host = marketingHost()
  if (!host.mcpContent) return { content: doc.content ?? [], exact: true }
  const { blocks, exact } = host.mcpContent.fromDoc(doc)
  return { content: blocks, exact }
}

function versionsBody(input: { source_language: string, versions: z.infer<typeof versionInput>[], audiences: string[] }): Record<string, unknown> {
  const versions: EmailVersions = {}
  for (const v of input.versions) {
    versions[v.language] = { subject: v.subject, ...(v.preheader ? { preheader: v.preheader } : {}), content: toDoc(v.content) }
  }
  if (!versions[input.source_language]) throw createError({ statusCode: 400, statusMessage: 'Include a version in the source language.' })
  return { source_language: input.source_language, versions, audiences: input.audiences }
}

function adminUrl(path: string): string {
  return `${String(useRuntimeConfig().public.siteUrl || '').replace(/\/$/, '')}${path}`
}

const listAudiencesTool = defineMcpTool({
  name: 'email_list_audiences',
  title: 'List Email Audiences',
  description: 'The audiences a site can email, each with how many people can receive it (opted in and not suppressed). Pass `selected` to also count people across several audiences once.',
  appId: APP,
  scope: 'marketing.access',
  readOnly: true,
  input: z.object({ org: orgInput, selected: z.array(z.string().max(80)).max(20).optional() }).strict(),
  handler: (input, ctx) => run(() => withOrgPermission(ctx.event, { appId: APP, org: input.org }, 'marketing.access', async (tx, tenant) => {
    const counts = await audienceCounts(marketingHost(), marketingTx(tx), tenant.orgId, input.selected ?? [])
    return result(`${counts.audiences.length} audience(s).`, counts)
  }))
})

const listEmailsTool = defineMcpTool({
  name: 'email_list',
  title: 'List Emails',
  description: 'A site\'s emails, newest first, with status, subject and delivery counts.',
  appId: APP,
  scope: 'marketing.access',
  readOnly: true,
  input: z.object({ org: orgInput, status: z.enum(['draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled', 'failed']).optional() }).strict(),
  handler: (input, ctx) => run(() => withOrgPermission(ctx.event, { appId: APP, org: input.org }, 'marketing.access', async (tx) => {
    let q = tx.selectFrom('marketing_email').select([
      'id', 'parent_id', 'status', 'audiences', 'source_language', 'scheduled_at', 'finished_at',
      'recipients', 'sent', 'skipped', 'failed', 'unsubscribes', 'created_at',
      sql<string>`versions -> source_language ->> 'subject'`.as('subject')
    ])
    if (input.status) q = q.where('status', '=', input.status)
    const emails = await q.orderBy('created_at', 'desc').limit(50).execute()
    return result(`${emails.length} email(s).`, { emails })
  }))
})

const getEmailTool = defineMcpTool({
  name: 'email_get',
  title: 'Get Email',
  description: 'One email with every language version (subject, preheader, body) and its audiences.',
  appId: APP,
  scope: 'marketing.access',
  readOnly: true,
  input: z.object({ org: orgInput, id: z.string().uuid() }).strict(),
  handler: (input, ctx) => run(() => withOrgPermission(ctx.event, { appId: APP, org: input.org }, 'marketing.access', async (tx, tenant) => {
    const email = await tx.selectFrom('marketing_email').selectAll().where('id', '=', input.id).executeTakeFirst()
    if (!email) throw createError({ statusCode: 404, statusMessage: 'Email not found.' })
    const versions = Object.entries(email.versions as EmailVersions).map(([language, v]) => ({ language, subject: v.subject, preheader: v.preheader ?? null, ...fromDoc(v.content) }))
    return result(`${email.status} email.`, {
      id: email.id,
      status: email.status,
      sourceLanguage: email.source_language,
      audiences: email.audiences,
      versions,
      adminUrl: adminUrl(`/@${tenant.orgSlug}/marketing/${email.id}`)
    })
  }))
})

const saveDraftTool = defineMcpTool({
  name: 'email_save_draft',
  title: 'Save Email Draft',
  get description() {
    return `Save a site email as a draft: a new one, or (with id) replace an existing draft. Nothing is sent: the champion reviews, tests and sends it in the admin. ${formatHelp()}`
  },
  appId: APP,
  scope: 'marketing.send',
  input: z.object({ org: orgInput, id: z.string().uuid().optional().describe('An existing draft to replace.'), ...draftFields }).strict(),
  handler: (input, ctx) => run(() => withOrgPermission(ctx.event, { appId: APP, org: input.org }, 'marketing.send', async (tx, tenant) => {
    const known = new Set((await marketingHost().listAudiences(marketingTx(tx), tenant.orgId)).map(a => a.key))
    const unknown = input.audiences.filter(a => !known.has(a))
    if (unknown.length) throw createError({ statusCode: 400, statusMessage: `Unknown audiences: ${unknown.join(', ')}. Use keys from email_list_audiences.` })
    const body = versionsBody(input)
    let id = input.id
    if (id) await marketingUpdateDraft(tx, tenant, id, body)
    else id = (await marketingCreateDraft(tx, tenant, body)).id
    await mcpLog(input.id ? 'UPDATE' : 'CREATE', 'marketing_email', id, ctx, { audiences: input.audiences }, tx)
    const url = adminUrl(`/@${tenant.orgSlug}/marketing/${id}`)
    return result(`Draft saved. Review and send it at ${url}`, { id, adminUrl: url })
  }))
})

const saveMultiDraftTool = defineMcpTool({
  name: 'email_save_multi_site_draft',
  title: 'Save Multi-Site Email Draft',
  get description() {
    return `Save one email to send from several of your sites as a draft (each person gets it once, from one site): a new one, or (with id) replace an existing draft. Nothing is sent: the champion reviews and sends it in the admin. ${formatHelp()}`
  },
  scope: 'marketing.send',
  input: z.object({
    id: z.string().uuid().optional().describe('An existing multi-site draft to replace.'),
    sites: z.array(z.string().min(1).max(64)).min(1).max(100).describe('Slugs of the sites to send from, from list_orgs.'),
    ...draftFields
  }).strict(),
  handler: (input, ctx) => run(async () => {
    const userId = ctx.auth.userId
    const sendable = await marketingSendableSites(userId)
    const missing = input.sites.filter(slug => !sendable.some(s => s.slug === slug))
    if (missing.length) throw createError({ statusCode: 403, statusMessage: `You can't send site email from: ${missing.join(', ')}.` })
    const body = { ...versionsBody(input), org_ids: input.sites.map(slug => sendable.find(s => s.slug === slug)!.id) }
    const host = marketingHost()
    const id = await runInUserTransaction(userId, { appId: host.personalAppId }, async (tx) => {
      const mtx = marketingTx(tx)
      if (input.id) {
        await marketingUpdateParentDraft(mtx, userId, input.id, body)
        return input.id
      }
      return (await marketingCreateParentDraft(mtx, userId, body)).id
    })
    await mcpLog(input.id ? 'UPDATE' : 'CREATE', 'marketing_parent', id, ctx, { sites: input.sites, audiences: input.audiences })
    const url = adminUrl(`/marketing/multi/${id}`)
    return result(`Draft saved. Review and send it at ${url}`, { id, adminUrl: url })
  })
})

export const marketingMcpTools = [
  listAudiencesTool,
  listEmailsTool,
  getEmailTool,
  saveDraftTool,
  saveMultiDraftTool
]
