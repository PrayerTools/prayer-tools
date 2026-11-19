// Stories and contact-us messages, which WordPress kept as comments on the
// campaign post, → v3 inbox threads (closed, at their original date), and
// stories also as unpublished `pt_story` rows. WordPress never asked to
// publish a story, so none may be published.
import type { SQL } from 'bun'
import type { Tx } from '@prayertools/shared/db/scope'
import { normalizeEmail, upsertContact } from '@prayertools/shared/crm'
import { openInboxThread } from '@prayertools/shared/inbox'
import { bumpStat } from '@prayertools/shared/stats'
import { localDateOf } from '@prayertools/shared/dates'
import type { CampaignRow } from '@prayertools/shared/subscriptions'
import { table, tableExists, wpDate } from './wp'
import { IMPORT_SOURCE } from './subscribers'

export const STORY_WORDING = 'wordpress-import'

export interface MessageCounts { stories: number, contacts: number, unparsed: number }

// `email` is normalized when valid; WordPress cut some addresses short (`ann@yahoo`).
export interface ParsedMessage { kind: 'story' | 'contact', email: string, valid: boolean, name: string | null, body: string }

const decode = (s: string) => s
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;|&#8217;/g, '\'').replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// The comment formats the plugin has written over the years.
export function parseMessage(type: string, content: string): ParsedMessage | null {
  const text = decode(content).replace(/@\[[^\]]*\]\(\d+\),?\s*/g, '').trim()
  const done = (kind: ParsedMessage['kind'], email: string, name: string | null, body: string): ParsedMessage | null => {
    const raw = email.replace(/[.,:;]+$/, '').toLowerCase()
    const { normalized, valid } = normalizeEmail(raw)
    const clean = body.trim()
    return clean && raw.includes('@') ? { kind, email: valid ? normalized : raw, valid, name: name?.trim() || null, body: clean } : null
  }
  if (type === 'stories') {
    const now = text.match(/^You received a Story feedback on \S+? submitted by (\S+@\S+?):\s*([\s\S]+)$/)
      ?? text.match(/^You received a Story feedback on \S+?,? submitted by (\S+@\S+?):\s*([\s\S]+)$/)
    if (now) return done('story', now[1]!, null, now[2]!)
    const old = text.match(/^Story feedback from \S+ by (\S+@\S+?):\s*([\s\S]+)$/)
    if (old) return done('story', old[1]!, null, old[2]!)
    return null
  }
  if (type === 'contact_us') {
    const now = text.match(/^(.*?)\s*\((\S+@\S+?)\) filled out the Contact Us form \([^)]*\)? ?on your campaign\. Here is what they said:\s*([\s\S]+)$/)
    if (now) return done('contact', now[2]!, now[1]!, now[3]!)
    const old = text.match(/^Message on \[?Contact Us\]?(?:\([^)]*\))? by (.*?)\s*(\S+@\S+?):\s*([\s\S]+)$/)
    if (old) return done('contact', old[2]!, old[1]!, old[3]!)
  }
  return null
}

export async function importMessages(wp: SQL, blogId: number, tx: Tx, input: {
  campaigns: Map<number, CampaignRow>
  // Names from the site's subscriptions, by address, for stories that have none.
  names: Map<string, string>
  // Every subscriber address on the site.
  emails: Set<string>
  defaultLanguage: string
  timezone: string
}): Promise<{ counts: MessageCounts, unparsed: string[] }> {
  const counts: MessageCounts = { stories: 0, contacts: 0, unparsed: 0 }
  const unparsed: string[] = []
  if (!await tableExists(wp, table(blogId, 'comments'))) return { counts, unparsed }
  const rows = await wp.unsafe(
    `SELECT c.comment_ID id, c.comment_post_ID post_id, c.comment_type type, c.comment_date_gmt at, c.comment_content content
     FROM ${table(blogId, 'comments')} c JOIN ${table(blogId, 'posts')} p ON p.ID = c.comment_post_ID
     WHERE p.post_type = 'campaigns' AND c.comment_type IN ('stories', 'contact_us') ORDER BY c.comment_ID`
  ) as { id: number, post_id: number, type: string, at: Date, content: string }[]

  for (const r of rows) {
    const parsed = parseMessage(r.type, r.content)
    // A shortened address is the one subscriber address that starts with it.
    const known = parsed && !parsed.valid ? [...input.names.keys(), ...input.emails].filter(e => e.startsWith(`${parsed.email}.`)) : []
    const email = parsed?.valid ? parsed.email : new Set(known).size === 1 ? known[0]! : null
    if (!parsed || !email) { counts.unparsed++; unparsed.push(`comment ${r.id} (${r.type})`); continue }
    const m = { ...parsed, email }
    const at = wpDate(r.at)
    const campaign = input.campaigns.get(Number(r.post_id)) ?? null
    const name = m.name ?? input.names.get(m.email) ?? null
    const contact = await upsertContact(tx, { email: m.email, name, source: IMPORT_SOURCE })
    const story = m.kind === 'story'
    const thread = await openInboxThread(tx, {
      channelId: contact.channelId,
      fromEmail: m.email,
      fromName: name,
      subject: m.body.split('\n')[0]!.slice(0, 80),
      body: m.body,
      source: story ? 'story' : 'contact_form',
      tags: story ? ['story', 'wordpress'] : ['contact', 'wordpress']
    })
    await tx.updateTable('inbox_conversations').set({ status: 'closed', last_message_at: at, created_at: at, updated_at: at }).where('id', '=', thread.conversationId).execute()
    await tx.updateTable('inbox_messages').set({ created_at: at, updated_at: at }).where('conversation_id', '=', thread.conversationId).execute()
    if (story) {
      await tx.insertInto('pt_story').values({
        campaign_id: campaign?.id ?? null,
        conversation_id: thread.conversationId,
        name,
        body: m.body,
        language: input.defaultLanguage,
        may_publish: false,
        may_platform: false,
        use_name: false,
        wording_version: STORY_WORDING,
        published: false,
        created_at: at
      }).execute()
      await bumpStat(tx, campaign?.id ?? null, localDateOf(at, campaign?.timezone ?? input.timezone), 'stories')
      counts.stories++
    } else {
      counts.contacts++
    }
  }
  return { counts, unparsed }
}
