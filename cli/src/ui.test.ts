import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { complete, onOff, parseCommand } from './commands'
import { cut, cycle, enterAction, menuLines, menuWindow, pickIndex, rowsTaken, strip, unframe, visible, wrap } from './ui'

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
    expect(long).toHaveLength(5)
    expect(long[4]).toContain('8 more lines')
  })
})

describe('slash-command menu', () => {
  const items = [
    { value: '/mode ', label: '/mode', help: 'who works' },
    { value: '/model ', label: '/model', help: 'pick a model' },
    { value: '/clear', label: '/clear', help: 'clear the screen' }
  ]
  it('cycles both ways and wraps around', () => {
    expect(cycle(-1, 3, 1)).toBe(0)
    expect(cycle(-1, 3, -1)).toBe(2)
    expect(cycle(2, 3, 1)).toBe(0)
    expect(cycle(0, 3, -1)).toBe(2)
    expect(cycle(0, 0, 1)).toBe(-1)
  })
  it('keeps the selected row in view and counts the rest', () => {
    expect(menuWindow(3, 0, 8)).toEqual({ start: 0, end: 3, more: 0 })
    expect(menuWindow(20, 0, 8)).toEqual({ start: 0, end: 8, more: 12 })
    expect(menuWindow(20, 10, 8)).toEqual({ start: 3, end: 11, more: 12 })
    expect(menuWindow(20, 19, 8)).toEqual({ start: 12, end: 20, more: 12 })
  })
  it('renders label, dim help, a marker on the highlighted row and "more"', () => {
    const lines = menuLines(items, 1, 60, 2).map(strip)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^ {4}\/mode {3}who works$/)
    expect(lines[1]).toMatch(/^ {2}› \/model {2}pick a model$/)
    expect(lines[2].trim()).toBe('… 1 more')
    for (const l of menuLines(items, 0, 20)) expect(visible(l)).toBeLessThanOrEqual(20)
    expect(menuLines([], 0, 60)).toEqual([])
  })
  it('on Enter submits a whole command, picks a partial one, and fills one that needs an argument', () => {
    expect(enterAction('/clear', [items[2]], -1)).toEqual({ kind: 'submit', line: '/clear' })
    expect(enterAction('/cl', [items[2]], -1)).toEqual({ kind: 'submit', line: '/clear' })
    expect(enterAction('/mo', items.slice(0, 2), -1)).toEqual({ kind: 'fill', line: '/mode ' })
    expect(enterAction('/mode', items.slice(0, 2), -1)).toEqual({ kind: 'submit', line: '/mode' })
    expect(enterAction('/model ', items.slice(0, 2), 1)).toEqual({ kind: 'fill', line: '/model ' })
    expect(enterAction('/model ', [{ value: '/model claude ', label: 'claude', help: '' }], -1)).toEqual({ kind: 'submit', line: '/model ' })
    expect(enterAction('/x', [], -1)).toEqual({ kind: 'submit', line: '/x' })
    expect(pickIndex('/cl', [items[2]], -1)).toBe(0)
    expect(pickIndex('/clear', [items[2]], -1)).toBe(-1)
  })
})

describe('live menu state', () => {
  it('reopens after editing an escaped line and fits a short terminal', async () => {
    class ReadlineStub extends EventEmitter {
      line = ''
      cursor = 0
      answer?: (line: string) => void
      pause() {}
      getCursorPos() { return { cols: this.cursor + 4, rows: 0 } }
      _refreshLine() {}
      question(_prompt: string, answer: (line: string) => void) { this.answer = answer; this._refreshLine() }
      _ttyWrite(text: string, key: { name?: string }) {
        if (key.name === 'return') { this.answer?.(this.line); return }
        if (key.name === 'backspace') this.line = this.line.slice(0, -1)
        else this.line += text
        this.cursor = this.line.length
        this._refreshLine()
      }
    }
    const rl = new ReadlineStub()
    const descriptors = [
      [process.stdin, 'isTTY'], [process.stdout, 'isTTY'],
      [process.stdout, 'rows'], [process.stdout, 'columns']
    ] as const
    const saved = descriptors.map(([object, key]) => Object.getOwnPropertyDescriptor(object, key))
    const writes: string[] = []
    const exits = process.listeners('exit')
    let pending: Promise<string> | undefined
    try {
      descriptors.forEach(([object, key]) => Object.defineProperty(object, key, { configurable: true, value: key === 'rows' ? 8 : key === 'columns' ? 80 : true }))
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { writes.push(String(chunk)); return true })
      vi.doMock('node:readline', () => ({ createInterface: () => rl }))
      vi.resetModules()
      const ui = await import('./ui')
      const { suggestions } = await import('./commands')
      ui.startSession()
      pending = ui.promptBox('test', 'normal hint', suggestions)
      const press = (text: string, name?: string) => {
        writes.length = 0
        rl._ttyWrite(text, { name })
        return writes.join('')
      }
      const opening = press('/')
      // An eight-row terminal has four suggestion rows plus the overflow count and bottom edge.
      expect(opening).toContain('\x1b[H\x1b[0J')
      expect(opening).toContain('\x1b[2;6H')
      expect(opening).toContain('14 more')
      expect(press('', 'escape')).toContain('normal hint')
      press('m')
      const reopened = press('', 'backspace')
      expect(reopened).toContain('14 more')
      press('', 'escape')
      press('', 'return')
      await pending
      pending = undefined
    } finally {
      if (pending) { rl.answer?.(''); await pending }
      vi.doUnmock('node:readline')
      vi.resetModules()
      vi.restoreAllMocks()
      descriptors.forEach(([object, key], i) => {
        if (saved[i]) Object.defineProperty(object, key, saved[i]!)
        else Reflect.deleteProperty(object, key)
      })
      for (const listener of process.listeners('exit')) if (!exits.includes(listener)) process.off('exit', listener)
    }
  })
})

describe('resizing and pasting', () => {
  it('counts the rows lines take after the terminal re-wraps them for a narrower pane', () => {
    expect(rowsTaken([109, 109, 40], 110)).toBe(3)
    expect(rowsTaken([109, 109, 40], 66)).toBe(5)
    expect(rowsTaken([0, 50], 50)).toBe(2)
  })

  it('drops mc box edges from text copied off its own screen', () => {
    const pasted = 'yes add the basic set of commands like /clear /usage /compact │ \n│   and give me other basic ones │'
    expect(unframe(pasted.split('\n')).join('\n')).toBe('yes add the basic set of commands like /clear /usage /compact\n  and give me other basic ones')
    expect(unframe(['│ › fix the readme typo                 │'])).toEqual(['fix the readme typo'])
    expect(unframe(['plain text stays'])).toEqual(['plain text stays'])
  })
})
