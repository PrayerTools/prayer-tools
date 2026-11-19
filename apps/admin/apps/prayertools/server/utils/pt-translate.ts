// AI translation of champion text or Tiptap content into another language.
// Scripture is never sent (verse nodes are skipped); placeholders like
// {site_name} stay verbatim. The result is returned for review, not saved.
import type { Transaction } from 'kysely'
import type { Database } from '#core/server/database/schema'
import { generate, isAiConfigured, resolveFeatureModel } from '#ai/server'
import { collectText, mapText } from '@prayertools/shared/tiptap'
import { getLanguage } from '@prayertools/shared/languages'
import type { TiptapDoc } from '@prayertools/shared/db/schema'

// Whether ptTranslate can run in this transaction's scope: a key and a model for pt.translate.
export async function ptTranslateAvailable(tx: Transaction<Database>): Promise<boolean> {
  return await isAiConfigured(tx) && !!(await resolveFeatureModel(tx, 'pt.translate'))
}

export async function ptTranslate(tx: Transaction<Database>, b: { texts?: string[], doc?: unknown, from?: string, to?: string }): Promise<{ texts?: string[], doc?: TiptapDoc | null }> {
  const from = getLanguage(b.from)
  const to = getLanguage(b.to)
  if (!from || !to) ptBadRequest('Unknown language.')
  if (!(await isAiConfigured(tx))) throw createError({ statusCode: 409, statusMessage: 'AI translation is not set up. An operator can add a key in Admin → AI, or an owner in the site\'s AI settings.' })
  const doc = b.doc ? ptDoc(b.doc) : null
  const texts = doc ? collectText(doc) : (Array.isArray(b.texts) ? b.texts.map(t => String(t)) : [])
  if (!texts.length) return doc ? { doc } : { texts: [] }
  if (texts.join('').length > 60_000) ptBadRequest('Too much text to translate at once.')
  const result = await generate<{ translations: string[] }>({
    tx,
    feature: 'pt.translate',
    system: `You translate prayer content for a Christian prayer campaign from ${from.name} into ${to.name}. Translate faithfully and naturally for native speakers, keeping the tone reverent and warm. Keep placeholders in curly braces (like {site_name}) exactly as they are. Keep leading and trailing spaces of each item. Return exactly one translation per input item, in order.`,
    messages: [{ role: 'user', content: JSON.stringify(texts) }],
    tool: {
      name: 'translations',
      description: 'The translated items, same count and order as the input array.',
      parameters: { type: 'object', properties: { translations: { type: 'array', items: { type: 'string' } } }, required: ['translations'] }
    },
    temperature: 0.2
  })
  const out = result.input.translations ?? []
  if (out.length !== texts.length) throw createError({ statusCode: 502, statusMessage: 'The translation came back incomplete. Please try again.' })
  if (!doc) return { texts: out }
  let i = 0
  return { doc: mapText(doc, () => out[i++] ?? '') }
}
