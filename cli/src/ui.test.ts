import { describe, expect, it } from 'vitest'
import { complete, onOff, parseCommand } from './commands'
import { cut, strip, visible, wrap } from './ui'

describe('text layout', () => {
  it('measures text without colour codes', () => {
    expect(strip('\x1b[1m\x1b[38;5;141mmc\x1b[0m ›')).toBe('mc ›')
    expect(visible('\x1b[32m✓\x1b[0m done')).toBe(6)
  })
  it('cuts with an ellipsis only when too long', () => {
    expect(cut('Edit src/app.ts', 40)).toBe('Edit src/app.ts')
    expect(cut('abcdefghij', 5)).toBe('abcd…')
    expect(cut('abc', 0)).toBe('')
  })
  it('word-wraps, keeps blank lines and indentation, and breaks very long words', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four'])
    expect(wrap('a\n\nb', 10)).toEqual(['a', '', 'b'])
    expect(wrap('  - item one two', 10)).toEqual(['  - item', '  one two'])
    expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
    for (const line of wrap('src/components/VeryLongFileName.tsx, src/shared/another.ts', 20)) expect(line.length).toBeLessThanOrEqual(20)
  })
})

describe('slash commands', () => {
  it('parses commands, aliases and plain words', () => {
    expect(parseCommand('/merge ab12')).toMatchObject({ name: 'merge', args: 'ab12' })
    expect(parseCommand('/review off')).toMatchObject({ name: 'review', args: 'off' })
    expect(parseCommand('/quit')).toMatchObject({ name: 'exit' })
    expect(parseCommand('list')).toMatchObject({ name: 'list' })
    expect(parseCommand('help')).toMatchObject({ name: 'help' })
    expect(parseCommand('/nope')).toEqual({ name: 'unknown', args: 'nope' })
  })
  it('treats everything else as a request', () => {
    expect(parseCommand('add a list view to the reports page')).toBeNull()
    expect(parseCommand('help me add dark mode')).toBeNull()
  })
  it('switches on, off, or toggles', () => {
    expect(onOff('on', false)).toBe(true)
    expect(onOff('off', true)).toBe(false)
    expect(onOff('', true)).toBe(false)
  })
  it('completes slash commands only', () => {
    expect(complete('/me')[0]).toEqual(['/merge'])
    expect(complete('/')[0].length).toBeGreaterThan(5)
    expect(complete('build a thing')[0]).toEqual([])
    expect(complete('/merge ab')[0]).toEqual([])
    expect(complete('/mode c')[0]).toEqual(['/mode claude', '/mode codex'])
  })
})

describe('transcript and answers', () => {
  it('renders Markdown answers: headings, bullets, code and inline styles', async () => {
    const { md, eventLines, tokens } = await import('./ui')
    const out = md('# Title\n\nSome **bold** and `code` text.\n\n- one\n- two that is long enough to wrap around\n\n```\nconst x = 1\n```', 24).map(strip)
    expect(out[0]).toBe('Title')
    expect(out).toContain('• one')
    expect(out.some(l => l.startsWith('  ') && !l.includes('const'))).toBe(true)
    expect(out).toContain('  const x = 1')
    expect(out.join(' ')).not.toMatch(/\*\*|`/)
    expect(tokens(850)).toBe('850')
    expect(tokens(4150)).toBe('4.2k')
    expect(tokens(1_200_000)).toBe('1.2M')
    const edit = eventLines('claude', { kind: 'tool', text: 'Edit src/a.ts', detail: '+3 −1' }, 80).map(strip)
    expect(edit).toEqual(['  Claude  ✎ Edit src/a.ts +3 −1'])
    const out2 = eventLines('codex', { kind: 'output', text: 'exit 1 · failed', ok: false }, 80).map(strip)
    expect(out2[0].trim()).toBe('⎿ exit 1 · failed')
    const long = eventLines('codex', { kind: 'text', text: Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n') }, 80).map(strip)
    expect(long).toHaveLength(9)
    expect(long[8]).toContain('4 more lines')
  })
})
