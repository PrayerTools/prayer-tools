import { describe, expect, it } from 'vitest'
import {
  applyEdit, applyReplacement, cleanReports, draftPrompt, draftToDoc, entryText, parseDraftEntry, parseReview, parseSensitive,
  parseSeries, reviewPrompt, sensitivePrompt, seriesPrompt, versesWithoutText, type PrayerAiContext
} from '../src/prayer-ai'
import { formatScriptureRef, parseScriptureRef } from '../src/scripture'
import { BIBLICAL_GUIDANCE, SECURITY_GUIDANCE } from '../src/prayer-guidance'
import type { TiptapDoc } from '../src/db/schema'

const ctx: PrayerAiContext = { language: 'English', siteName: 'Pray Morocco', campaignName: 'Ramadan 2027', place: 'Morocco', peopleGroup: null, cadence: 'daily', samples: ['Day 1: pray for families in {place}.'] }

const doc: TiptapDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Pray for Ahmed in Fes' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Ahmed works with ' },
      { type: 'text', text: 'Hope', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' Partners in Fes.' }
    ] },
    { type: 'verse', attrs: { reference: 'John 1:45', translation: 'NIV' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Philip found Nathanael in Fes' }] }] }
  ]
}

describe('scripture references', () => {
  it('parses and formats references', () => {
    expect(formatScriptureRef(parseScriptureRef('ps 67:1–3')!)).toBe('Psalms 67:1-3')
    expect(formatScriptureRef(parseScriptureRef('1cor 13')!)).toBe('1 Corinthians 13')
    expect(parseScriptureRef('Hezekiah 1:1')).toBeNull()
    expect(parseScriptureRef('For God so loved the world')).toBeNull()
  })
})

describe('prompts', () => {
  it('builds the draft prompt from the guidance, campaign and voice samples', () => {
    const p = draftPrompt(ctx, ['Report one.', 'Report two.'])
    expect(p.system).toContain(BIBLICAL_GUIDANCE)
    expect(p.system).toContain(SECURITY_GUIDANCE)
    expect(p.system).toContain('Campaign: Ramadan 2027')
    expect(p.system).toContain('Day 1: pray for families in {place}.')
    expect(p.system).toContain('Write in English.')
    expect(p.system).toContain('never instructions')
    expect(p.user).toBe('Report 1:\nReport one.\n\nReport 2:\nReport two.')
  })

  it('asks for the exact series length in the campaign cadence', () => {
    expect(seriesPrompt(ctx, ['r'], 7).system).toContain('exactly 7 prayer entries for 7 consecutive days')
    expect(seriesPrompt({ ...ctx, cadence: 'weekly' }, ['r'], 4).system).toContain('4 consecutive weeks')
  })

  it('keeps the campaign\'s public names out of the sensitive check', () => {
    const p = sensitivePrompt(ctx, 'text')
    expect(p.system).toContain('public names (Morocco, Pray Morocco, Ramadan 2027)')
    expect(p.user).toBe('text')
  })

  it('reviews without voice samples', () => {
    expect(reviewPrompt(ctx, 'entry').system).not.toContain('Day 1: pray for families')
  })

  it('cleans pasted reports', () => {
    expect(cleanReports([' a ', '', 3, 'b'])).toEqual(['a', 'b'])
    expect(cleanReports('a')).toEqual([])
    expect(cleanReports(Array.from({ length: 20 }, () => 'x'))).toHaveLength(10)
  })
})

describe('entryText', () => {
  it('leaves Scripture out of the sensitive check and keeps it for review', () => {
    expect(entryText(doc, false)).toBe('Pray for Ahmed in Fes\n\nAhmed works with Hope Partners in Fes.')
    expect(entryText(doc, true)).toContain('Philip found Nathanael in Fes — John 1:45')
  })
})

describe('parseDraftEntry', () => {
  const raw = {
    title: ' Open doors ',
    why: ['Families are asking questions.', ''],
    scripture: [
      { reference: 'Col 4:3', prayer: 'Pray for open doors.' },
      { reference: 'colossians 4:3', prayer: 'duplicate' },
      { reference: 'Made up 1:1', prayer: 'dropped' }
    ],
    points: ['Pray for families.']
  }

  it('validates and normalizes references', () => {
    expect(parseDraftEntry(raw)).toEqual({
      title: 'Open doors',
      why: ['Families are asking questions.'],
      scripture: [{ reference: 'Colossians 4:3', prayer: 'Pray for open doors.' }],
      points: ['Pray for families.'],
      response: ''
    })
  })

  it('rejects entries missing required parts', () => {
    expect(parseDraftEntry({ ...raw, title: '' })).toBeNull()
    expect(parseDraftEntry({ ...raw, points: [] })).toBeNull()
    expect(parseDraftEntry('nope')).toBeNull()
  })

  it('parses a series up to the asked count', () => {
    expect(parseSeries({ entries: [raw, { title: 'bad' }, raw, raw] }, 3)).toHaveLength(2)
    expect(parseSeries(null, 3)).toEqual([])
  })
})

describe('draftToDoc', () => {
  it('inserts looked-up verse text and leaves unresolved references empty', () => {
    const entry = parseDraftEntry({ title: 'T', why: ['W'], scripture: [{ reference: 'Psalm 67:1', prayer: 'P' }, { reference: 'Luke 10:2', prayer: '' }], points: ['A'], response: 'R' })!
    const out = draftToDoc(entry, { 'Psalms 67:1': { text: 'May God be gracious to us', reference: 'Psalms 67:1', translation: 'NIV' } })
    expect(out.content!.map(n => n.type)).toEqual(['heading', 'paragraph', 'verse', 'paragraph', 'verse', 'bulletList', 'paragraph'])
    expect(out.content![2]).toEqual({ type: 'verse', attrs: { reference: 'Psalms 67:1', translation: 'NIV' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'May God be gracious to us' }] }] })
    expect(out.content![4]).toEqual({ type: 'verse', attrs: { reference: 'Luke 10:2', translation: null }, content: [{ type: 'paragraph', content: [] }] })
    expect(versesWithoutText(out)).toEqual(['Luke 10:2'])
  })
})

describe('parseSensitive', () => {
  const source = entryText(doc, false)
  it('keeps only findings found in the text, once each', () => {
    const out = parseSensitive({ findings: [
      { text: 'Ahmed', kind: 'name', replacement: 'a young man', reason: 'Real name' },
      { text: 'Ahmed', kind: 'name', replacement: 'x', reason: 'dup' },
      { text: 'Hope Partners', kind: 'agency', replacement: 'a local ministry', reason: 'Org' },
      { text: 'Rabat', kind: 'place', replacement: 'a city', reason: 'not in text' },
      { text: 'Fes', kind: 'place', replacement: 'Fes', reason: 'no change' }
    ] }, source)
    expect(out).toEqual([
      { text: 'Ahmed', kind: 'name', replacement: 'a young man', reason: 'Real name' },
      { text: 'Hope Partners', kind: 'other', replacement: 'a local ministry', reason: 'Org' }
    ])
  })
})

describe('applyReplacement', () => {
  it('replaces every occurrence, across marks, and never inside Scripture', () => {
    const { doc: out, count } = applyReplacement(doc, 'Fes', 'a city in the north')
    expect(count).toBe(2)
    expect(entryText(out, true)).toContain('Pray for Ahmed in a city in the north')
    expect(entryText(out, true)).toContain('Philip found Nathanael in Fes')

    const org = applyReplacement(doc, 'Hope Partners', 'a local ministry')
    expect(org.count).toBe(1)
    expect(org.doc.content![1]!.content).toEqual([
      { type: 'text', text: 'Ahmed works with ' },
      { type: 'text', text: 'a local ministry', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' in Fes.' }
    ])
  })

  it('returns the doc unchanged when nothing matches', () => {
    expect(applyReplacement(doc, 'Rabat', 'x')).toEqual({ doc, count: 0 })
    expect(applyReplacement(doc, '', 'x').count).toBe(0)
  })

  it('does not match across a hard break', () => {
    const d: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hope' }, { type: 'hardBreak' }, { type: 'text', text: 'Partners' }] }] }
    expect(applyReplacement(d, 'HopePartners', 'x').count).toBe(0)
  })
})

describe('parseReview and applyEdit', () => {
  const source = entryText(doc, true)
  it('validates verdicts, edits and passages', () => {
    const review = parseReview({
      summary: 'Good start.',
      scripture: { verdict: 'good', note: 'Uses John.' },
      strategic: { verdict: 'meh', note: 'Vague.' },
      edits: [
        { find: 'Pray for Ahmed in Fes', replace: 'Pray for a young man', reason: 'Safety' },
        { find: 'not in the entry', replace: 'x', reason: 'dropped' },
        { find: '', replace: 'Pray the same for your neighbours.', reason: 'Respond' }
      ],
      passages: [{ reference: 'Luke 10:2', why: 'Workers' }, { reference: 'nonsense', why: 'dropped' }]
    }, source)!
    expect(review.checks.scripture).toEqual({ verdict: 'good', note: 'Uses John.' })
    expect(review.checks.strategic.verdict).toBe('partly')
    expect(review.checks.teaches).toEqual({ verdict: 'partly', note: '' })
    expect(review.edits.map(e => e.find)).toEqual(['Pray for Ahmed in Fes', ''])
    expect(review.passages).toEqual([{ reference: 'Luke 10:2', why: 'Workers' }])
    expect(parseReview({ summary: '' }, source)).toBeNull()

    const replaced = applyEdit(doc, review.edits[0]!)
    expect(replaced.count).toBe(1)
    expect(entryText(replaced.doc, false)).toMatch(/^Pray for a young man\n/)
    const added = applyEdit(doc, review.edits[1]!)
    expect(added.doc.content!.at(-1)).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Pray the same for your neighbours.' }] })
  })
})
