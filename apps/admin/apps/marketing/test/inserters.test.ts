import { describe, expect, it } from 'vitest'
import { marketingFitContent, type MarketingNodeKind } from '../app/utils/marketing-inserters'

const KINDS: Record<string, MarketingNodeKind> = { paragraph: 'textblock', heading: 'textblock', bulletList: 'block', listItem: 'block', image: 'block', text: 'inline', hardBreak: 'inline' }
const fit = (nodes: Parameters<typeof marketingFitContent>[0]) => marketingFitContent(nodes, t => KINDS[t], m => ['bold', 'link'].includes(m))
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('marketingFitContent', () => {
  it('keeps content the editor knows', () => {
    const nodes = [p('One'), { type: 'image', attrs: { src: 'https://x/y.png', alt: 'A' } }, { type: 'bulletList', content: [{ type: 'listItem', content: [p('Two')] }] }]
    expect(fit(nodes)).toEqual({ content: nodes, changed: false })
  })

  it('unwraps unknown nodes and leaves out unknown leaves and marks', () => {
    const { content, changed } = fit([
      { type: 'callout', content: [p('Inside'), { type: 'text', text: 'loose' }] },
      { type: 'embed', attrs: { src: 'x' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }, { type: 'highlight' }] }, { type: 'emoji', content: [{ type: 'text', text: ':)' }] }, { type: 'image' }] }
    ])
    expect(content).toEqual([
      p('Inside'),
      p('loose'),
      { type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] }, { type: 'text', text: ':)' }] }
    ])
    expect(changed).toBe(true)
  })
})
