// Scripture references like "John 3:16-18" or "Psalm 23", parsed into
// bolls.life book numbers. English book names and common abbreviations.
const BOOKS = [
  'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'joshua', 'judges', 'ruth', '1 samuel', '2 samuel', '1 kings', '2 kings',
  '1 chronicles', '2 chronicles', 'ezra', 'nehemiah', 'esther', 'job', 'psalms', 'proverbs', 'ecclesiastes', 'song of songs', 'isaiah',
  'jeremiah', 'lamentations', 'ezekiel', 'daniel', 'hosea', 'joel', 'amos', 'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk', 'zephaniah',
  'haggai', 'zechariah', 'malachi', 'matthew', 'mark', 'luke', 'john', 'acts', 'romans', '1 corinthians', '2 corinthians', 'galatians',
  'ephesians', 'philippians', 'colossians', '1 thessalonians', '2 thessalonians', '1 timothy', '2 timothy', 'titus', 'philemon', 'hebrews',
  'james', '1 peter', '2 peter', '1 john', '2 john', '3 john', 'jude', 'revelation'
]
const ALIASES: Record<string, string> = { psalm: 'psalms', ps: 'psalms', 'song of solomon': 'song of songs', revelations: 'revelation', gen: 'genesis', ex: 'exodus', matt: 'matthew', mt: 'matthew', mk: 'mark', lk: 'luke', jn: 'john', rom: 'romans', rev: 'revelation', isa: 'isaiah', jer: 'jeremiah', prov: 'proverbs', phil: 'philippians', eph: 'ephesians', col: 'colossians', heb: 'hebrews', gal: 'galatians' }

export interface ScriptureRef {
  book: number
  name: string
  chapter: number
  from: number | null
  to: number | null
}

export function parseScriptureRef(ref: string): ScriptureRef | null {
  const m = ref.trim().match(/^([1-3]?\s*[a-z .]+?)\s+(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/i)
  if (!m) return null
  let name = m[1]!.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim().replace(/^([1-3])(\S)/, '$1 $2')
  name = ALIASES[name] ?? name
  let idx = BOOKS.indexOf(name)
  if (idx < 0) idx = BOOKS.findIndex(b => b.startsWith(name) && name.length >= 3)
  if (idx < 0) return null
  return { book: idx + 1, name: BOOKS[idx]!, chapter: Number(m[2]), from: m[3] ? Number(m[3]) : null, to: m[4] ? Number(m[4]) : (m[3] ? Number(m[3]) : null) }
}

export function formatScriptureRef(r: ScriptureRef): string {
  const title = r.name.replace(/\b\w/g, c => c.toUpperCase())
  return `${title} ${r.chapter}${r.from ? `:${r.from}${r.to && r.to !== r.from ? `-${r.to}` : ''}` : ''}`
}
