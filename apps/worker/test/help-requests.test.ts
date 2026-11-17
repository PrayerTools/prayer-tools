import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { withOrg, type Tx } from '@prayertools/shared/db/scope'
import { openInboxThread } from '@prayertools/shared/inbox'
import { askForHelp, handleHelpRequest, HelpRequestError, type ConversationEventLogger } from '@prayertools/shared/help-requests'
import { drainJobs } from '../src/jobs/processor'
import { cleanup, closeEnv, createCampaign, createSite, createSubscriber, testCtx, testEmail, testEnv, type TestEnv } from './helpers'

let env: TestEnv
beforeAll(() => { env = testEnv() })
afterEach(async () => { await cleanup(env) })
afterAll(async () => { await closeEnv(env) })

const REPLY = new Set(['inbox.access', 'inbox.send'])

interface Logged { conversationId: string, eventType: string, message: string, userId?: string }
function recorder(): { log: ConversationEventLogger, events: Logged[] } {
  const events: Logged[] = []
  return { events, log: async (_tx, conversationId, eventType, message, opts) => { events.push({ conversationId, eventType, message, userId: opts.userId }) } }
}

async function user(name: string, opts: { operator?: boolean } = {}): Promise<{ id: string, email: string }> {
  const email = testEmail(env, name.toLowerCase())
  const row = await env.admin.insertInto('users').values({ email, display_name: name, is_admin: opts.operator ?? false, created: new Date(), updated: new Date() }).returning('id').executeTakeFirstOrThrow()
  env.users.push(row.id)
  return { id: row.id, email }
}

async function join(userId: string, orgId: string, role = 'pt-editor'): Promise<void> {
  await env.admin.insertInto('memberships').values({ user_id: userId, org_id: orgId, roles: sql`${`{${role}}`}::text[]` as never, created_at: new Date(), updated_at: new Date() }).execute()
}

// A site with one contact-form conversation from an intercessor.
async function siteWithConversation(): Promise<{ orgId: string, slug: string, conversationId: string, writerEmail: string }> {
  const { orgId, slug } = await createSite(env)
  const campaign = await createCampaign(env, orgId)
  const { email } = await createSubscriber(env, orgId, campaign)
  const conversationId = await withOrg(env.admin, orgId, async (tx) => {
    const channel = await tx.selectFrom('crm_channels').select('id').where('normalized_value', '=', email).executeTakeFirstOrThrow()
    const res = await openInboxThread(tx, { channelId: channel.id, fromEmail: email, fromName: 'Writer Person', subject: 'Please delete my data', body: 'Private message body', source: 'contact_form' })
    return res.conversationId
  })
  return { orgId, slug, conversationId, writerEmail: email }
}

function ask(orgId: string, userId: string, conversationId: string, note: unknown, log: ConversationEventLogger, perms = REPLY) {
  return withOrg(env.app, orgId, (tx: Tx) => askForHelp(tx, { orgId, userId, perms, conversationId, note }, log))
}

async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p
  } catch (err) {
    if (err instanceof HelpRequestError) return err.statusCode
    throw err
  }
  throw new Error('expected a refusal')
}

describe('asking Prayer.Tools for help', () => {
  it('stores the request, logs it on the conversation and queues the operator alert', async () => {
    const site = await siteWithConversation()
    const ana = await user('Ana')
    await join(ana.id, site.orgId)
    const { log, events } = recorder()
    const { id } = await ask(site.orgId, ana.id, site.conversationId, '  They want their data deleted.  ', log)

    const row = await env.admin.selectFrom('pt_help_request').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    expect(row).toMatchObject({ org_id: site.orgId, conversation_id: site.conversationId, requested_by: ana.id, note: 'They want their data deleted.', handled_at: null })
    expect(events).toEqual([{ conversationId: site.conversationId, eventType: 'pt_help_requested', message: 'Sent to Prayer.Tools by Ana: They want their data deleted.', userId: ana.id }])
    const job = await env.admin.selectFrom('pt_job').select(['type', 'org_id', 'reference_id']).where('reference_id', '=', id).executeTakeFirstOrThrow()
    expect(job).toEqual({ type: 'help_request_alert', org_id: site.orgId, reference_id: id })

    const conversation = await withOrg(env.admin, site.orgId, tx => tx.selectFrom('inbox_conversations').select(['status', 'assigned_user_id']).where('id', '=', site.conversationId).executeTakeFirstOrThrow())
    expect(conversation).toEqual({ status: 'open', assigned_user_id: null })
  })

  it('refuses a second open request on the same conversation, and allows one after it is handled', async () => {
    const site = await siteWithConversation()
    const ana = await user('Ana')
    const op = await user('Op', { operator: true })
    const { log } = recorder()
    const first = await ask(site.orgId, ana.id, site.conversationId, 'First', log)
    expect(await refused(ask(site.orgId, ana.id, site.conversationId, 'Again', log))).toBe(409)
    const open = await env.admin.selectFrom('pt_help_request').select('id').where('conversation_id', '=', site.conversationId).execute()
    expect(open).toHaveLength(1)

    await withOrg(env.app, site.orgId, tx => handleHelpRequest(tx, { orgId: site.orgId, requestId: first.id, operatorId: op.id, reply: '' }, log))
    await ask(site.orgId, ana.id, site.conversationId, 'Something new', log)
  })

  it('refuses a team member who cannot reply in the inbox', async () => {
    const site = await siteWithConversation()
    const viewer = await user('Viewer')
    const { log, events } = recorder()
    expect(await refused(ask(site.orgId, viewer.id, site.conversationId, 'Help', log, new Set(['inbox.access'])))).toBe(403)
    expect(events).toEqual([])
    const rows = await env.admin.selectFrom('pt_help_request').select('id').where('conversation_id', '=', site.conversationId).execute()
    expect(rows).toEqual([])
  })

  it('refuses another site\'s conversation, an empty note and an overlong one', async () => {
    const a = await siteWithConversation()
    const b = await siteWithConversation()
    const ana = await user('Ana')
    const { log } = recorder()
    expect(await refused(ask(a.orgId, ana.id, b.conversationId, 'Help', log))).toBe(404)
    expect(await refused(ask(a.orgId, ana.id, a.conversationId, '   ', log))).toBe(400)
    expect(await refused(ask(a.orgId, ana.id, a.conversationId, 'x'.repeat(1001), log))).toBe(400)
    const rows = await env.admin.selectFrom('pt_help_request').select('id').where('org_id', 'in', [a.orgId, b.orgId]).execute()
    expect(rows).toEqual([])
  })
})

describe('answering a help request', () => {
  it('logs the reply on the conversation and notifies the team member who asked', async () => {
    const site = await siteWithConversation()
    const ana = await user('Ana')
    const op = await user('Op', { operator: true })
    await join(ana.id, site.orgId)
    const { log, events } = recorder()
    const { id } = await ask(site.orgId, ana.id, site.conversationId, 'Help', log)
    await withOrg(env.app, site.orgId, tx => handleHelpRequest(tx, { orgId: site.orgId, requestId: id, operatorId: op.id, reply: 'Delete the contact; we purged the rest.' }, log))

    const row = await env.admin.selectFrom('pt_help_request').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    expect(row.handled_by).toBe(op.id)
    expect(row.handled_at).not.toBeNull()
    expect(row.reply).toBe('Delete the contact; we purged the rest.')
    expect(events.at(-1)).toEqual({ conversationId: site.conversationId, eventType: 'pt_help_handled', message: 'Prayer.Tools: Delete the contact; we purged the rest.', userId: op.id })
    const notes = await withOrg(env.admin, site.orgId, tx => tx.selectFrom('notifications').select(['user_id', 'app_id', 'title', 'body', 'link', 'email_mode']).where('user_id', 'in', [ana.id, op.id]).execute())
    expect(notes).toEqual([{ user_id: ana.id, app_id: 'inbox', title: 'Prayer.Tools answered your help request', body: 'Delete the contact; we purged the rest.', link: `/inbox/${site.conversationId}?help=${id}`, email_mode: 'immediate' }])

    expect(await refused(withOrg(env.app, site.orgId, tx => handleHelpRequest(tx, { orgId: site.orgId, requestId: id, operatorId: op.id, reply: '' }, log)))).toBe(409)
  })

  it('notifies no one who has left the site', async () => {
    const site = await siteWithConversation()
    const ana = await user('Ana')
    const op = await user('Op', { operator: true })
    const { log } = recorder()
    const { id } = await ask(site.orgId, ana.id, site.conversationId, 'Help', log)
    await withOrg(env.app, site.orgId, tx => handleHelpRequest(tx, { orgId: site.orgId, requestId: id, operatorId: op.id, reply: 'Done' }, log))
    const notes = await withOrg(env.admin, site.orgId, tx => tx.selectFrom('notifications').select('id').where('user_id', '=', ana.id).execute())
    expect(notes).toEqual([])
  })

  it('goes with its conversation', async () => {
    const site = await siteWithConversation()
    const ana = await user('Ana')
    const { log } = recorder()
    const { id } = await ask(site.orgId, ana.id, site.conversationId, 'Help', log)
    await withOrg(env.admin, site.orgId, tx => tx.deleteFrom('inbox_conversations').where('id', '=', site.conversationId).execute())
    expect(await env.admin.selectFrom('pt_help_request').select('id').where('id', '=', id).execute()).toEqual([])
  })
})

describe('help request isolation', () => {
  it('shows a site only its own requests and refuses writing into another site', async () => {
    const a = await siteWithConversation()
    const b = await siteWithConversation()
    const ana = await user('Ana')
    const { log } = recorder()
    await ask(a.orgId, ana.id, a.conversationId, 'From A', log)
    const fromB = await ask(b.orgId, ana.id, b.conversationId, 'From B', log)

    const seen = await withOrg(env.app, a.orgId, tx => tx.selectFrom('pt_help_request').select(['org_id', 'note']).execute())
    expect(seen).toEqual([{ org_id: a.orgId, note: 'From A' }])
    expect(await env.app.selectFrom('pt_help_request').select('id').execute()).toEqual([])
    await expect(withOrg(env.app, a.orgId, tx => tx.insertInto('pt_help_request').values({ org_id: b.orgId, conversation_id: b.conversationId, note: 'x' }).execute())).rejects.toThrow()
    const op = await user('Op', { operator: true })
    expect(await refused(withOrg(env.app, a.orgId, tx => handleHelpRequest(tx, { orgId: a.orgId, requestId: fromB.id, operatorId: op.id, reply: '' }, log)))).toBe(404)
  })
})

describe('operator alert', () => {
  it('emails every operator the site, who asked and the note, and nothing of the conversation', async () => {
    const site = await siteWithConversation()
    const ana = await user('Ana')
    const op1 = await user('Op', { operator: true })
    const op2 = await user('Op', { operator: true })
    const { log } = recorder()
    await ask(site.orgId, ana.id, site.conversationId, 'Someone may be at risk.', log)

    const ctx = testCtx(env)
    await drainJobs(ctx, ctx.log)
    const ours = ctx.mails.filter(m => (m.tags ?? []).includes('help_request_alert'))
    expect(ours.map(m => m.to)).toEqual(expect.arrayContaining([op1.email, op2.email]))
    expect(ours.map(m => m.to)).not.toContain(ana.email)
    const mail = ours.find(m => m.to === op1.email)!
    expect(mail.subject).toBe(`Help request from Test ${site.slug}`)
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('Someone may be at risk.')
      expect(part).toContain('Ana')
      expect(part).toContain('http://localhost:2380/admin/pt/help-requests')
      expect(part).not.toContain('Please delete my data')
      expect(part).not.toContain('Private message body')
      expect(part).not.toContain(site.writerEmail)
      expect(part).not.toContain('Writer Person')
    }
  })
})
