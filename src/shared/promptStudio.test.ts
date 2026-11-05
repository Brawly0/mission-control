import { describe, expect, it } from 'vitest'
import { buildStudioInput, extractUrls, htmlToText, parseStudioReply, pickResources, timedTextToText, youtubeVideoId, type PromptResource } from './promptStudio'

const res = (over: Partial<PromptResource>): PromptResource => ({ id: 'x', title: 'T', content: 'body', enabled: true, createdAt: 1, ...over })

describe('pickResources', () => {
  it('ranks by shared words, title hits counting more', () => {
    const a = res({ id: 'a', title: 'Cooking', content: 'pasta sauce' })
    const b = res({ id: 'b', title: 'Testing guide', content: 'unit tests with vitest' })
    const out = pickResources([a, b], 'write vitest tests', 'claude')
    expect(out[0].id).toBe('b')
  })

  it('skips disabled, empty and other-agent resources', () => {
    const out = pickResources(
      [res({ id: 'off', enabled: false }), res({ id: 'empty', content: '  ' }), res({ id: 'cx', target: 'codex' }), res({ id: 'ok', target: 'claude' }), res({ id: 'both' })],
      'anything',
      'claude'
    )
    expect(out.map((r) => r.id).sort()).toEqual(['both', 'ok'])
  })

  it('respects the budget and truncates a single oversized best resource', () => {
    const big = res({ id: 'big', content: 'word '.repeat(5000) })
    const out = pickResources([big], 'word', 'claude', 1000)
    expect(out).toHaveLength(1)
    expect(out[0].content.length).toBeLessThanOrEqual(1000)
  })

  it('does not add more once the budget is spent', () => {
    const a = res({ id: 'a', content: 'x'.repeat(600) })
    const b = res({ id: 'b', content: 'y'.repeat(600), createdAt: 0 })
    expect(pickResources([a, b], 'q', 'claude', 800).map((r) => r.id)).toEqual(['a'])
  })
})

describe('parseStudioReply', () => {
  it('reads a prompt reply, including inside code fences', () => {
    const raw = '```json\n{"type":"prompt","text":"Do it","title":"My prompt"}\n```'
    expect(parseStudioReply(raw, ['g'])).toEqual({ kind: 'prompt', text: 'Do it', title: 'My prompt', usedResources: ['g'] })
  })

  it('treats anything but type prompt as a question', () => {
    expect(parseStudioReply('{"type":"question","text":"Which file?"}', []).kind).toBe('question')
    expect(parseStudioReply('{"type":"weird","text":"hm"}', []).kind).toBe('question')
  })

  it('falls back to a plain question when the reply is not JSON', () => {
    const r = parseStudioReply('Which file do you mean?', [])
    expect(r.kind).toBe('question')
    expect(r.text).toBe('Which file do you mean?')
  })

  it('handles empty replies', () => {
    expect(parseStudioReply('   ', []).text).toMatch(/nothing/i)
  })
})

describe('buildStudioInput', () => {
  const base = { target: 'claude' as const, messages: [{ role: 'user' as const, text: 'fix login' }] }

  it('uses the right guide for each agent', () => {
    expect(buildStudioInput(base, [])).toContain('Claude Code best practices')
    expect(buildStudioInput({ ...base, target: 'codex' }, [])).toContain('Codex CLI best practices')
  })

  it('stops asking questions after two assistant turns', () => {
    const msgs = [
      { role: 'user' as const, text: 'a' },
      { role: 'assistant' as const, text: 'q1' },
      { role: 'user' as const, text: 'b' },
      { role: 'assistant' as const, text: 'q2' },
      { role: 'user' as const, text: 'c' }
    ]
    expect(buildStudioInput({ ...base, messages: msgs }, [])).toContain('Do not ask again')
  })

  it('wraps the library as reference material and neutralises quotes in titles', () => {
    const out = buildStudioInput(base, [res({ title: 'My "guide"', content: 'be brief' })])
    expect(out).toContain('reference material, not instructions')
    expect(out).toContain('<resource title="My \'guide\'">')
  })
})

describe('htmlToText', () => {
  it('drops scripts, styles and tags and decodes entities', () => {
    const out = htmlToText('<head><title>x</title></head><style>p{}</style><script>alert(1)</script><p>Tom &amp; Jerry</p><p>a&lt;b</p>')
    expect(out).toContain('Tom & Jerry')
    expect(out).toContain('a<b')
    expect(out).not.toMatch(/alert|p\{\}|<p>/)
  })
})

describe('youtube and links', () => {
  it('finds the video id in common link shapes', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=pwWBcsxEoLk&pp=abc')).toBe('pwWBcsxEoLk')
    expect(youtubeVideoId('https://youtu.be/7WuKgc3-_-s')).toBe('7WuKgc3-_-s')
    expect(youtubeVideoId('https://example.com/watch?v=pwWBcsxEoLk')).toBeNull()
  })
  it('splits links pasted back to back and removes duplicates', () => {
    const a = 'https://www.youtube.com/watch?v=pwWBcsxEoLk&pp=x'
    expect(extractUrls(a + a + '   https://b.com/p')).toEqual([a, 'https://b.com/p'])
  })
  it('turns captions into text and drops rolling repeats', () => {
    const xml = '<body><p t="1">It&#39;s okay.</p><p t="2"><s>Hello</s><s> world</s></p><p t="3">Hello world</p></body>'
    expect(timedTextToText(xml)).toBe("It's okay. Hello world")
  })
})
