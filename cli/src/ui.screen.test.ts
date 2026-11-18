import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInterface, type Interface } from 'node:readline'
import { PassThrough } from 'node:stream'
import { Screen } from './screen.test-util'

describe('terminal screen regression', () => {
  let screen: Screen
  let ui: typeof import('./ui')
  let rl: Interface
  let input: PassThrough
  let writes: string[]
  let restore: () => void
  beforeEach(async () => {
    vi.stubEnv('TERM', 'xterm-256color')
    const props = [[process.stdout, 'columns'], [process.stdout, 'rows'], [process.stdout, 'isTTY'], [process.stdin, 'isTTY']] as const
    const saved = props.map(([o, k]) => Object.getOwnPropertyDescriptor(o, k))
    const exits = process.listeners('exit')
    props.forEach(([o, k]) => Object.defineProperty(o, k, { configurable: true, value: k === 'columns' ? 100 : k === 'rows' ? 30 : true }))
    restore = () => {
      props.forEach(([o, k], i) => { if (saved[i]) Object.defineProperty(o, k, saved[i]!); else Reflect.deleteProperty(o, k) })
      for (const l of process.listeners('exit')) if (!exits.includes(l)) process.off('exit', l)
    }
    screen = new Screen(100, 30)
    writes = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { writes.push(String(chunk)); screen.write(String(chunk)); return true })
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { process.stdout.write(args.join(' ') + '\n') })
    vi.spyOn(process.stdin, 'pause').mockReturnValue(process.stdin)
    vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin)
    input = new PassThrough()
    vi.doMock('node:readline', () => ({ createInterface: (options: any) => (rl = createInterface({ ...options, input })) }))
    vi.resetModules()
    ui = await import('./ui')
  })
  afterEach(() => {
    rl?.close(); input.destroy()
    vi.doUnmock('node:readline'); vi.restoreAllMocks(); vi.unstubAllEnvs(); restore(); vi.resetModules()
  })
  const resize = (cols: number, rows: number) => {
    screen.resize(cols, rows)
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: cols })
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: rows })
    process.stdout.emit('resize')
  }
  it.each(['tree', 'lines'] as const)('keeps a single %s live frame across shrinking and expanding', async view => {
    const { settings } = await import('./settings')
    settings.view = view
    const live = new ui.Live('LIVE-HINT')
    try {
      live.start('claude', 'build'); live.start('codex', 'build')
      live.event('claude', { kind: 'tool', text: 'Edit src/one.ts' })
      for (const [cols, rows] of [[60, 18], [24, 5], [120, 40], [80, 2], [100, 30]]) {
        resize(cols, rows)
        live.event('codex', { kind: 'output', text: 'EVENT', ok: true })
        expect(screen.scrollback).not.toContain('LIVE-HINT')
        expect(screen.text.match(/LIVE-HINT/g)?.length ?? 0).toBeLessThanOrEqual(1)
        expect(screen.scrollback).not.toMatch(/running|starting|ctrl\+c/)
      }
      expect(screen.visible.match(/LIVE-HINT/g)).toHaveLength(1)
    } finally { live.stop() }
    expect(screen.text).not.toContain('LIVE-HINT')
    expect(screen.text).not.toMatch(/ctrl\+c|running/)
    expect(screen.cursorShown).toBe(true)
  })
  it('finishes both agents once, restores input, and draws a card then the next prompt', async () => {
    ui.startSession()
    const marker = vi.fn()
    process.stdin.on('keypress', marker)
    const initial = process.stdout.listenerCount('resize')
    const live = new ui.Live('LIVE-HINT')
    live.start('claude', 'build'); live.start('codex', 'build')
    live.event('claude', { kind: 'tool', text: 'Edit src/one.ts' })
    resize(45, 8)
    live.finish('claude', true, 1000); live.finish('codex', true, 1500)
    writes.length = 0
    live.stop()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatch(/^\x1b\[\?2026h/)
    expect(writes[0]).toContain('\x1b[?25h')
    expect(process.stdout.listenerCount('resize')).toBe(initial)
    process.stdin.emit('keypress', 'k', { name: 'k' })
    expect(marker).toHaveBeenCalledTimes(1)
    process.stdin.off('keypress', marker)
    const before = writes.length
    live.stop(); live.event('claude', { kind: 'text', text: 'late' })
    await new Promise(resolve => setTimeout(resolve, 110))
    expect(writes).toHaveLength(before)
    ui.card('Done', [['ALL DONE']])
    expect(screen.text.match(/Claude/g)).toHaveLength(2) // event and summary
    expect(screen.text.match(/Codex/g)).toHaveLength(1)
    expect(screen.text).not.toContain('LIVE-HINT')
    const pending = ui.promptBox('next', 'NEXT-HINT')
    expect(screen.visible).toContain('ALL DONE')
    expect(screen.visible).toContain('mc · next')
    input.write('next request\r')
    expect(await pending).toBe('next request')
    expect(screen.text.match(/Done/g)).toHaveLength(1)
    expect(screen.text.match(/next request/g)).toHaveLength(1)
    expect(screen.cursorShown).toBe(true)
  })
  it('keeps multiline paste and middle-of-line editing after resize', async () => {
    ui.startSession()
    const pending = ui.promptBox('test', 'hint')
    input.write('ac\x1b[D')
    resize(24, 5)
    input.write('b\x1b[F\rsecond line\r')
    expect(await pending).toBe('abc\nsecond line')
    expect(screen.text).toContain('abc')
    expect(screen.text).toContain('second line')
  })
  it('routes Ctrl+C during a run and releases keys only after teardown', () => {
    ui.startSession()
    const onInterrupt = vi.fn()
    process.on('SIGINT', onInterrupt)
    const live = new ui.Live()
    try {
      live.start('claude', 'build')
      resize(20, 3)
      process.stdin.emit('data', Buffer.from('\x03'))
      expect(onInterrupt).toHaveBeenCalledTimes(1)
      live.stop()
      expect(screen.cursorShown).toBe(true)
      expect(process.stdin.listeners('data').some(l => l.name === 'onRunKey')).toBe(false)
    } finally { live.stop(); process.off('SIGINT', onInterrupt) }
  })
  it('allows scrollback browsing without leaking a prompt or losing its edit state', async () => {
    ui.say('PERMANENT')
    ui.startSession()
    const pending = ui.promptBox('test', 'TEMPORARY')
    input.write('kept')
    input.write('\x1b[5~')
    expect(screen.text).toContain('PERMANENT')
    expect(screen.text).not.toContain('TEMPORARY')
    resize(32, 8)
    input.write('\x1b[6~')
    expect(screen.text).toContain('kept')
    input.write(' keys\r')
    expect(await pending).toBe('kept keys')
    expect(screen.text.match(/PERMANENT/g)).toHaveLength(1)
  })
  it('restores the normal screen when the prompt receives EOF', async () => {
    ui.startSession()
    const pending = ui.promptBox('test', 'TEMPORARY')
    input.write('\x04')
    expect(await pending).toBe('')
    expect(screen.text).not.toContain('TEMPORARY')
    expect(screen.cursorShown).toBe(true)
  })
  it('keeps card borders inside narrow columns and handles excessive indentation', () => {
    resize(24, 10)
    ui.card('A title longer than the pane', [['x'.repeat(80)]])
    const lines = screen.text.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines.every(l => l.length === 23)).toBe(true)
    expect(lines[0]).toMatch(/╮$/)
    expect(lines[1]).toMatch(/│$/)
    expect(lines[2]).toMatch(/╯$/)
    expect(ui.wrap('          word', 3).every(l => l.length <= 3)).toBe(true)
  })
  it.each(['short', 'x'.repeat(220), '/'])('redraws and submits prompt %s after resize', async value => {
    ui.startSession()
    const pending = ui.promptBox('test', 'PROMPT-HINT', () => Array.from({ length: 12 }, (_, i) => ({ value: `/item${i}`, label: `/item${i}`, help: 'help' })))
    input.write(value)
    for (const [cols, rows] of [[40, 12], [24, 5], [110, 30], [65, 18]]) {
      resize(cols, rows)
      expect(screen.scrollback).not.toMatch(/PROMPT-HINT|\/item|╭/)
      expect(screen.visible.match(/╭/g)).toHaveLength(1)
      expect(screen.visible.match(/╯/g)).toHaveLength(1)
    }
    if (value === '/') input.emit('keypress', '\x1b', { name: 'escape' })
    input.write('\r')
    expect(await pending).toBe(value)
    expect(screen.text.match(/╭/g)).toHaveLength(1)
    expect(screen.text.match(/╯/g)).toHaveLength(1)
    expect(screen.text).not.toMatch(/PROMPT-HINT|\/item/)
    expect(screen.cursorShown).toBe(true)
  })
})
