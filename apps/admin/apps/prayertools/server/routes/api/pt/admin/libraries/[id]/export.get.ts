// A platform library's drafts as a content pack. Images on this server's
// storage are referenced as "images/<name>" and listed with their URLs, so the
// caller can download them next to pack.json; other image URLs stay as links.
import type { TiptapNode } from '@prayertools/shared/db/schema'

function localizeImages(node: TiptapNode, images: Map<string, string>): TiptapNode {
  const src = node.attrs?.src
  const name = node.type === 'image' && typeof src === 'string' ? ptStoredLibraryImageName(src) : null
  if (name) images.set(`images/${name}`, src as string)
  return {
    ...node,
    ...(name ? { attrs: { ...node.attrs, src: `images/${name}` } } : {}),
    ...(node.content ? { content: node.content.map(c => localizeImages(c, images)) } : {})
  }
}

export default defineEventHandler(async (event) => {
  await ptRequireLibraryOperator(event)
  const lib = await ptPlatformLibrary(getRouterParam(event, 'id')!)
  const rows = await ptAdminDb().selectFrom('pt_library_entry').select(['day', 'language', 'draft'])
    .where('library_id', '=', lib.id).orderBy('day').orderBy('language').execute()
  const images = new Map<string, string>()
  const entries = rows.map(r => ({ day: r.day, language: r.language, doc: localizeImages(r.draft as TiptapNode, images) }))
  const pack = {
    key: lib.key,
    title: lib.title,
    description: lib.description,
    cadence: lib.cadence,
    source_language: lib.source_language,
    license: lib.license,
    license_note: lib.license_note,
    credit: lib.credit,
    topics: lib.topics,
    template_keys: lib.template_keys,
    series: lib.series,
    edition: lib.edition,
    entries
  }
  return { pack, images: [...images].map(([path, url]) => ({ path, url })) }
})
