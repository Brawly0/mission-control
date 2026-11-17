import { createInterface, type Completer, type Interface } from 'node:readline'
import type { AgentEvent } from './agents'
import type { Suggestion } from './commands'
import { NAME, type Side } from './plan'
import { settings } from './settings'
import { addOutput, addTool, finishTree, newTree, renderTree, summary, type AgentTree } from './tree'

const tty = Boolean(process.stdout.isTTY)
const color = tty && !process.env.NO_COLOR
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)

export const c = {
  bold: paint('1'),
  dim: paint('2'),
  italic: paint('3'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  code: paint('38;5;180'),
  claude: paint('38;5;173'),
  codex: paint('38;5;75'),
  mc: paint('38;5;141')
}

/** Real terminal columns (boxes and live rows must never wrap, or redrawing breaks). */
const columns = () => Math.max(40, process.stdout.columns || 100)
/** Width of cards, the input box and the transcript. */
const boxWidth = () => Math.max(40, Math.min(columns() - 1, 110))

export function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}

export function visible(s: string): number {
  return [...strip(s)].length
}

/** Cuts plain text to `max` characters with an ellipsis. */
export function cut(s: string, max: number): string {
  const chars = [...s]
  if (max <= 0) return ''
  return chars.length > max ? chars.slice(0, Math.max(0, max - 1)).join('') + '…' : s
}

/** Word-wraps plain text to `max` columns, keeping blank lines and breaking words longer than a line. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\t/g, '  ').split(/\r?\n/)) {
    const indent = /^\s*/.exec(para)![0]
    const words = para.trim().split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let line = indent
    for (let word of words) {
      while ([...word].length > max - indent.length) {
        if (line.trim()) { out.push(line); line = indent }
        const room = max - indent.length
        out.push(indent + [...word].slice(0, room).join(''))
        word = [...word].slice(room).join('')
      }
      if (!word) continue
      if (!line.trim()) line = indent + word
      else if ([...line].length + 1 + [...word].length <= max) line += ' ' + word
      else { out.push(line); line = indent + word }
    }
    if (line.trim()) out.push(line)
  }
  return out
}

const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - visible(s)))

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** 850 · 4.1k · 1.2M */
export function tokens(n: number): string {
  return n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`
}

// ── Markdown (answers and reports) ──────────────────────────────────────────

/** **bold** and `code` inside one line. */
export function inline(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, (_, t) => c.bold(t)).replace(/`([^`]+)`/g, (_, t) => c.code(t))
}

/** Enough Markdown for an agent's answer: headings, bullets, code blocks, bold and inline code, wrapped to `width`. */
export function md(text: string, width: number): string[] {
  const out: string[] = []
  let fence = false
  for (const raw of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue }
    if (fence) { out.push(c.dim('  ' + cut(raw, width - 2))); continue }
    const heading = /^#{1,6}\s+(.*)$/.exec(raw)
    if (heading) { out.push(c.bold(inline(heading[1].replace(/\*\*/g, '')))); continue }
    const bullet = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(raw)
    if (bullet) {
      const lead = bullet[1] + (bullet[2] ? `${bullet[2]}. ` : '• ')
      wrap(bullet[3], width - lead.length).forEach((l, i) => out.push((i ? ' '.repeat(lead.length) : lead) + inline(l)))
      continue
    }
    if (!raw.trim()) { if (out.length && out[out.length - 1] !== '') out.push(''); continue }
    for (const l of wrap(raw, width)) out.push(inline(l))
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

// ── Transcript ──────────────────────────────────────────────────────────────

export function tag(side: Side | 'mc'): string {
  const label = side === 'mc' ? 'mc' : NAME[side]
  return c[side](c.bold(label.padEnd(7)))
}

/** Where an agent's lines start: "  Claude  ". */
const GUTTER = 2 + 7 + 1
const FILE_TOOL = /^(Edit|Write|MultiEdit|NotebookEdit|Delete) (.+)$/
/** A reply that is the fixed end-of-turn report; it is shown in the result card instead of the transcript. */
const REPORT = /^\s*(\*\*)?(changed|verdict)(\*\*)?\s*:/im

function toolText(e: AgentEvent): string {
  if (e.text.startsWith('$ ')) return c.dim('$ ') + e.text.slice(2)
  const space = e.text.indexOf(' ')
  const name = space < 0 ? e.text : e.text.slice(0, space)
  const rest = space < 0 ? '' : e.text.slice(space)
  const size = e.detail ? ' ' + e.detail.split(' ').map(p => (p.startsWith('+') ? c.green(p) : c.red(p))).join(' ') : ''
  return c.bold(name) + rest + size
}

/** The transcript lines for one event, Claude Code style: a coloured name, an icon, then the content. */
export function eventLines(side: Side, e: AgentEvent, width = boxWidth()): string[] {
  const head = `  ${tag(side)} `
  const indent = ' '.repeat(GUTTER)
  const room = Math.max(20, width - GUTTER - 2)
  const many = (icon: string, body: string[], style: (s: string) => string, max: number) => {
    const shown = body.slice(0, max).map((l, i) => (i ? indent + '  ' : head + icon + ' ') + style(l))
    if (body.length > max) shown.push(indent + '  ' + c.dim(`… ${body.length - max} more line${body.length - max === 1 ? '' : 's'}`))
    return shown
  }
  switch (e.kind) {
    case 'tool': {
      const file = FILE_TOOL.test(e.text)
      const detail = e.detail ? visible(e.detail) + 1 : 0
      return [head + (file ? c.green('✎') : c[side]('▸')) + ' ' + toolText({ ...e, text: cut(e.text, room - detail) })]
    }
    case 'output': return [indent + c.dim('⎿ ') + (e.ok === false ? c.red(cut(e.text, room)) : c.dim(cut(e.text, room)))]
    case 'text': return many(c[side]('●'), md(e.text, room), s => s, 8)
    case 'thinking': return many(c.dim('∴'), wrap(e.text.replace(/\n\s*\n/g, '\n'), room), s => c.dim(c.italic(s)), 4)
    case 'todo': return [head + c.dim('◦ ') + c.dim(`${e.detail ?? ''} `) + cut(e.text, room - 8)]
    case 'error': return many(c.red('✗'), wrap(e.text, room), c.red, 4)
    default: return [head + c.dim('· ' + cut(e.text, room))]
  }
}

export function say(text: string): void {
  console.log(`  ${tag('mc')} ${text}`)
}

/** A step of the run: "● Plan  Claude reads the repo and decides who does what". */
export function heading(title: string, note = ''): void {
  console.log('\n' + c.mc('● ') + c.bold(title) + (note ? '  ' + c.dim(note) : ''))
}

export function block(text: string, indent = '    '): void {
  for (const line of text.split(/\r?\n/)) console.log(indent + line)
}

// ── Cards ───────────────────────────────────────────────────────────────────

/**
 * A rounded card. Each section is a list of lines (may contain colour); sections are split by a rule.
 * A section given as a pair of columns is laid out side by side.
 */
export type Section = string[] | { left: string[]; right: string[] }

export function card(title: string, sections: Section[], paintBorder: (s: string) => string = c.mc): void {
  const w = boxWidth()
  const inner = w - 4
  const head = `╭─ ${title} `
  const out = [paintBorder('╭─ ') + c.bold(title) + ' ' + paintBorder('─'.repeat(Math.max(1, w - visible(head) - 1)) + '╮')]
  const half = Math.floor((inner - 3) / 2)
  const two = (s: Section | undefined) => Boolean(s && !Array.isArray(s))
  // The column bar sits at position half + 3; a rule joins it from above, below or both.
  const rule = (l: string, up: boolean, down: boolean, r: string) =>
    paintBorder(l + '─'.repeat(half + 2) + (up && down ? '┼' : up ? '┴' : down ? '┬' : '─') + '─'.repeat(w - half - 5) + r)
  const row = (s: string) => out.push(paintBorder('│') + ' ' + pad(s, inner) + ' ' + paintBorder('│'))
  sections.forEach((section, i) => {
    if (i > 0) out.push(rule('├', two(sections[i - 1]), two(section), '┤'))
    if (Array.isArray(section)) { section.forEach(row); return }
    const n = Math.max(section.left.length, section.right.length)
    for (let k = 0; k < n; k++) row(pad(section.left[k] ?? '', half) + ' ' + paintBorder('│') + ' ' + (section.right[k] ?? ''))
  })
  out.push(rule('╰', two(sections[sections.length - 1]), false, '╯'))
  console.log(out.join('\n'))
}

/** Inner width of a card (for wrapping text before it goes in), and of one column in a two-column section. */
export const cardInner = () => boxWidth() - 4
export const cardColumn = () => Math.floor((cardInner() - 3) / 2)
/** Wide enough for the two agents side by side. */
export const sideBySide = () => cardColumn() >= 36

// ── Live status while agents work ───────────────────────────────────────────

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface Row {
  side: Side
  phase: string
  now: string
  step?: string
  thinking?: number
  started: number
  tools: number
  files: Set<string>
  tokens: number
  state: 'run' | 'ok' | 'fail'
  ms?: number
  tree: AgentTree
}

/**
 * Screen rows that lines of these widths take now. When the terminal gets narrower (a pane is split, a window is
 * dragged smaller) it re-wraps what is already on screen, so a full-width line becomes two or more rows.
 */
export function rowsTaken(widths: number[], cols = process.stdout.columns || 100): number {
  return widths.reduce((n, w) => n + Math.max(1, Math.ceil(w / cols)), 0)
}

/** The tree needs room; small terminals (and /view lines) get one row per agent. */
const treeView = () => settings.view === 'tree' && (process.stdout.rows || 0) >= 18 && columns() >= 60

/**
 * One live row per agent at the bottom of the terminal (spinner, what it's doing now, timer, counts) and a hint line
 * under them, repainted in place. Above them the transcript scrolls: every tool call, command results, what the
 * agents say and think, and errors. Without a terminal (piped output) every event is printed as a line.
 */
export class Live {
  private rows: Row[] = []
  /** Visible width of each line of the live area on screen, so it can be cleared even after the terminal re-wrapped it. */
  private drawn: number[] = []
  private frame = 0
  private timer?: ReturnType<typeof setInterval>

  constructor(private hint = '') {}

  start(side: Side, phase: string): void {
    this.rows.push({ side, phase, now: 'starting…', started: Date.now(), tools: 0, files: new Set(), tokens: 0, state: 'run', tree: newTree(side, phase, this.frame) })
    if (!tty) return
    if (!this.timer) {
      holdInput()
      process.stdout.write('\x1b[?25l')
      this.timer = setInterval(() => { this.frame++; this.repaint() }, 100)
    }
    this.repaint()
  }

  event(side: Side, e: AgentEvent): void {
    const row = this.rows.find(r => r.side === side && r.state === 'run')
    if (!row) return
    if (e.kind !== 'thinking' && e.kind !== 'usage') row.thinking = undefined
    switch (e.kind) {
      case 'tool': {
        row.tools++
        row.now = e.text
        const file = FILE_TOOL.exec(e.text)
        if (file) row.files.add(file[2])
        addTool(row.tree, e.text, this.frame)
        break
      }
      case 'thinking': row.thinking = row.tree.thinking = e.tokens ?? row.thinking ?? 0; row.now = 'thinking'; if (!e.text) return; break
      case 'usage': row.tokens = row.tree.tokens = side === 'codex' ? row.tokens + (e.tokens ?? 0) : e.tokens ?? row.tokens; return
      case 'output': addOutput(row.tree, e.ok !== false, this.frame); break
      case 'todo': if (row.step === e.text) return; row.step = e.text; break
      case 'text': row.now = 'writing'; if (/^\s*(```|\{\s*")/.test(e.text)) { this.print([`  ${tag(side)} ${c[side]('●')} ${c.dim('plan ready')}`]); return } if (REPORT.test(e.text)) { this.print([`  ${tag(side)} ${c[side]('●')} ${c.dim('finished · report in the summary')}`]); return } break
      case 'info': row.now = e.text; return
    }
    this.print(eventLines(side, e))
  }

  finish(side: Side, ok: boolean, ms: number): void {
    const row = this.rows.find(r => r.side === side && r.state === 'run')
    if (!row) return
    row.state = ok ? 'ok' : 'fail'
    row.ms = ms
    finishTree(row.tree, ok, ms, this.frame)
    this.repaint()
  }

  /** Clears the live rows and leaves one final line per agent in the scrollback. */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); releaseInput() }
    this.timer = undefined
    if (tty) {
      this.clear()
      const tree = treeView()
      for (const r of this.rows) {
        if (r.state === 'run') { r.state = 'fail'; r.now = 'stopped'; r.ms = Date.now() - r.started; finishTree(r.tree, false, r.ms, this.frame) }
        // The tree collapses to one line per agent.
        console.log(tree ? summary(r.tree, NAME[r.side], duration(r.ms ?? 0)) : this.line(r))
      }
      process.stdout.write('\x1b[?25h')
    }
    this.rows = []
  }

  private print(lines: string[]): void {
    if (!tty) { console.log(lines.join('\n')); return }
    // One write per frame (synchronized output where the terminal supports it), so the tree doesn't flicker.
    process.stdout.write('\x1b[?2026h' + this.clearCode() + lines.join('\n') + '\n' + this.frameCode() + '\x1b[?2026l')
  }

  private clear(): void {
    process.stdout.write(this.clearCode())
  }

  private clearCode(): string {
    const code = this.drawn.length ? `\x1b[${rowsTaken(this.drawn)}F\x1b[0J` : ''
    this.drawn = []
    return code
  }

  /** The live area: the work tree (or one row per agent), then the hint line. */
  private frameCode(): string {
    if (!tty || !this.rows.length) return ''
    const hint = c.dim(cut(`  ctrl+c stops${this.hint ? ' · ' + this.hint : ''}`, columns() - 1))
    let lines: string[]
    if (treeView()) {
      // Leave part of the screen for the transcript above.
      const height = Math.max(12, Math.floor((process.stdout.rows || 30) * 0.7)) - 1
      lines = renderTree(this.rows.map(r => r.tree), {
        frame: this.frame, width: columns() - 1, height, aura: settings.aura, phase: this.rows[0].phase,
        names: NAME, duration: t => duration(t.ms ?? Date.now() - t.started)
      })
    } else lines = this.rows.map(r => this.line(r))
    lines.push(hint)
    this.drawn = lines.map(visible)
    return lines.join('\n') + '\n'
  }

  private repaint(): void {
    if (!tty) return
    process.stdout.write('\x1b[?2026h' + this.clearCode() + this.frameCode() + '\x1b[?2026l')
  }

  private line(r: Row): string {
    const max = columns() - 1
    const icon = r.state === 'ok' ? c.green('✓') : r.state === 'fail' ? c.red('✗') : c[r.side](SPIN[this.frame % SPIN.length])
    const left = `  ${icon} ${tag(r.side)} ${c.dim(r.phase.padEnd(7))}`
    const parts = [
      duration(r.ms ?? Date.now() - r.started),
      `${r.tools} tool${r.tools === 1 ? '' : 's'}`,
      ...(r.files.size ? [`${r.files.size} file${r.files.size === 1 ? '' : 's'}`] : []),
      ...(r.tokens ? [`↓ ${tokens(r.tokens)}`] : [])
    ]
    // In a narrow pane the counts give way (tokens first, the timer last) so the row never wraps: a wrapped row
    // breaks the repaint and leaves a copy behind on every frame.
    while (parts.length > 1 && visible(left) + parts.join(' · ').length + 2 + 10 > max) parts.pop()
    const right = c.dim(cut(parts.join(' · '), Math.max(0, max - visible(left) - 2)))
    const room = Math.max(0, max - visible(left) - visible(right) - 2)
    let status: string
    if (r.state === 'ok') status = 'done'
    else if (r.state === 'fail') status = r.now === 'stopped' ? 'stopped' : 'failed'
    else if (r.thinking !== undefined) status = `thinking…${r.thinking ? ` ~${tokens(r.thinking)} tokens` : ''}`
    else status = r.now
    const step = r.state === 'run' && r.step ? cut(r.step, Math.max(0, Math.floor(room / 2))) + ' · ' : ''
    const middle = cut(step + status, Math.max(0, room))
    const text = r.state === 'fail' ? c.red(middle) : r.state === 'ok' ? c.green(middle) : r.thinking !== undefined ? c.italic(middle) : middle
    return left + text + ' '.repeat(Math.max(1, room - visible(middle) + 2)) + right
  }
}

/** Make sure the cursor comes back if mc exits while the live rows are showing. */
if (tty) process.on('exit', () => process.stdout.write('\x1b[?25h'))

// ── Input ───────────────────────────────────────────────────────────────────

/**
 * The interactive prompt keeps one readline open for the whole session: re-creating it per question switches the
 * console in and out of raw mode, and keys typed in between (like a quick Enter) can get lost.
 */
let session: Interface | undefined

export function startSession(completer?: Completer): void {
  if (!process.stdin.isTTY || session) return
  session = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 100, removeHistoryDuplicates: true, ...(completer ? { completer } : {}) })
  // Ctrl+C at a prompt quits like it does during a run (readline would otherwise just pause).
  session.on('SIGINT', () => process.emit('SIGINT'))
  session.pause()
}

/**
 * While agents run, the console stays in raw mode and readline stops seeing keys: mc reads them itself, acts on
 * Ctrl+C and drops the rest, so typing doesn't echo into the live rows or leak into the next prompt.
 * (Switching to cooked mode and back instead loses the first keys typed after a run on Windows.)
 */
let keypress: Array<(...args: any[]) => void> = []
const onRunKey = (d: Buffer | string) => { if (String(d).includes('\x03')) process.emit('SIGINT') }
function holdInput(): void {
  if (!session || !process.stdin.isTTY || keypress.length) return
  session.pause()
  keypress = process.stdin.listeners('keypress') as typeof keypress
  process.stdin.removeAllListeners('keypress')
  process.stdin.on('data', onRunKey)
  process.stdin.resume()
}
function releaseInput(): void {
  if (!session || !process.stdin.isTTY) return
  process.stdin.off('data', onRunKey)
  process.stdin.pause()
  for (const fn of keypress) process.stdin.on('keypress', fn)
  keypress = []
}

function forget(rl: Interface, answer: string): void {
  const history = (rl as unknown as { history?: string[] }).history
  if (answer.trim() && history?.[0] === answer) history.shift()
}

/** Asks one question. Only answers at the main prompt go in the ↑ history, not y/n or one-key answers. */
export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ''
  if (session) {
    const rl = session
    const answer = await new Promise<string>(resolve => rl.question(question, resolve))
    rl.pause()
    forget(rl, answer)
    return answer
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => { rl.close(); process.emit('SIGINT') })
  try {
    return await new Promise<string>(resolve => rl.question(question, resolve))
  } finally {
    rl.close()
  }
}

const PROMPT = () => c.mc('│') + ' ' + c.mc(c.bold('›')) + ' '

/**
 * Text copied from mc's own screen (an earlier request in its box) brings the box edges along:
 * "│ › add the commands │". Those edges are dropped so the request reads as typed.
 */
export function unframe(lines: string[]): string[] {
  return lines.map(l => l.replace(/^\s*│\s?(?:›\s)?/, '').replace(/\s*│\s*$/, '').replace(/\s+│\s+/g, ' '))
}

/** One of readline's internal steps (a symbol in current Node, a method in older ones). */
function internalKey(rl: Interface, name: string): string | symbol | undefined {
  for (let o: object | null = rl; o; o = Object.getPrototypeOf(o)) {
    const sym = Object.getOwnPropertySymbols(o).find(s => s.description === name && typeof (o as any)[s] === 'function')
    if (sym) return sym
  }
  return typeof (rl as any)[name] === 'function' ? name : undefined
}
/** readline's "redraw the line" step. */
const refreshKey = (rl: Interface) => internalKey(rl, '_refreshLine')
/** readline's "handle one key" step. */
const ttyWriteKey = (rl: Interface) => internalKey(rl, '_ttyWrite')

// ── Slash-command menu ──────────────────────────────────────────────────────

/** Rows of suggestions shown at once. */
export const MENU_ROWS = 8

/** The next (dir 1) or previous (dir -1) item, wrapping. From "nothing picked yet" (-1) it goes to the first or the last. */
export function cycle(sel: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1
  if (sel < 0) return dir > 0 ? 0 : count - 1
  return (sel + dir + count) % count
}

/** Which slice of `count` items is on screen so `sel` stays visible, and how many are left out. */
export function menuWindow(count: number, sel: number, max = MENU_ROWS): { start: number; end: number; more: number } {
  const start = sel >= max ? sel - max + 1 : 0
  const end = Math.min(count, start + max)
  return { start, end, more: count - (end - start) }
}

/**
 * The item Enter would use: the one moved to with Tab/↑↓, or else the first match while a word is still being typed
 * ('/cl' → '/clear'). Nothing when the line is already a whole command or value, or ends in a space.
 */
export function pickIndex(line: string, items: Suggestion[], sel: number): number {
  if (sel >= 0) return sel < items.length ? sel : -1
  if (!items.length || line.endsWith(' ')) return -1
  return items.some(i => i.value.trimEnd() === line.trimEnd()) ? -1 : 0
}

/**
 * What Enter does while the menu is open: submit the line as it is, submit the picked value, or fill a value that
 * still needs an argument ('/model ') and keep the prompt open so the next level shows.
 */
export function enterAction(line: string, items: Suggestion[], sel: number): { kind: 'submit' | 'fill'; line: string } {
  const i = pickIndex(line, items, sel)
  if (i < 0) return { kind: 'submit', line }
  const value = items[i].value
  return { kind: value.endsWith(' ') ? 'fill' : 'submit', line: value }
}

/** The menu rows: label in a column, help dimmed, the highlighted row in mc colour, and "… N more" when cut short. */
export function menuLines(items: Suggestion[], highlight: number, width: number, max = MENU_ROWS): string[] {
  if (!items.length) return []
  const { start, end, more } = menuWindow(items.length, highlight, max)
  const shown = items.slice(start, end)
  const col = Math.min(Math.max(...shown.map(i => [...i.label].length)) + 2, Math.max(8, Math.floor(width / 2)))
  const out = shown.map((item, k) => {
    const on = start + k === highlight
    const label = cut(item.label, col - 1)
    const room = width - 4 - col
    const help = room > 3 && item.help ? c.dim(cut(item.help, room)) : ''
    return '  ' + (on ? c.mc(c.bold('› ' + pad(label, col))) : '  ' + pad(label, col)) + help
  })
  if (more > 0) out.push(c.dim(cut(`    … ${more} more`, width)))
  return out
}

/**
 * The input box, Claude Code style: a closed frame with the settings in its top edge and a hint line under it.
 * readline clears everything below the cursor whenever it redraws the line, so the bottom edge and the hint are drawn
 * again after each redraw. Pasting several lines sends them as one request. Once sent, the box is closed around what
 * was typed, so the scrollback reads like a chat.
 *
 * With `suggest`, a line starting with '/' shows a menu of matching commands in place of the hint line. Tab and ↓
 * move to the next one, Shift+Tab and ↑ to the previous one, putting it on the line; Enter runs or fills it, Esc
 * hides the menu until the line changes. With the menu closed, ↑↓ are history and Tab is the usual completer.
 */
export async function promptBox(status: string, hint: string, suggest?: (line: string) => Suggestion[]): Promise<string> {
  // Sizes are read again on every redraw: the pane can be resized while the prompt waits.
  const edges = () => {
    const w = boxWidth()
    const fill = Math.max(1, w - visible(`╭─ mc · ${status} `) - 1)
    return {
      w,
      top: c.mc('╭─ ') + c.mc(c.bold('mc')) + c.dim(` · ${status} `) + c.mc('─'.repeat(fill) + '╮'),
      bottom: c.mc('╰' + '─'.repeat(w - 2) + '╯'),
      hintLine: c.dim(cut('  ' + hint, columns() - 1))
    }
  }
  let box = edges()
  console.log(box.top)
  const rl = session
  if (!tty || !rl) return ask(PROMPT())

  process.stdout.write(c.mc('│') + ' '.repeat(box.w - 2) + c.mc('│') + '\r\n' + box.bottom + '\r\n' + box.hintLine + '\x1b[2F')
  const key = refreshKey(rl)
  const original = key ? (rl as any)[key] : undefined
  const fits = () => visible(PROMPT()) + [...rl.line].length < (process.stdout.columns || 100)

  // Menu state. `base` is the line as typed before Tab/↑↓ started cycling, so the matches don't collapse to the one
  // just put on the line; `sel` is the item moved to (-1 = none yet); `closedFor` is the line Esc hid the menu for.
  const tkey = ttyWriteKey(rl)
  const tty0 = tkey ? (rl as any)[tkey] : undefined
  const menuOn = Boolean(suggest && key && original && tty0)
  let base: string | null = null
  let sel = -1
  let closedFor: string | null = null
  let active = true
  const items = (): Suggestion[] => {
    if (!menuOn || !active || closedFor === rl.line) return []
    const line = base ?? rl.line
    return line.startsWith('/') ? suggest!(line) : []
  }
  const below = (): string[] => {
    const list = items()
    if (!list.length) return [box.hintLine]
    // Leave room for the top edge, input, bottom edge and the overflow count.
    const max = Math.max(1, Math.min(MENU_ROWS, (process.stdout.rows || 24) - 4))
    return menuLines(list, pickIndex(base ?? rl.line, list, sel), columns() - 1, max)
  }
  // Repaints the right edge, bottom edge and the hint or menu under the input line, then puts the cursor back.
  const paint = () => {
    if (!fits()) return
    const used = visible(PROMPT()) + [...rl.line].length
    const rows = [box.bottom, ...below()]
    // Make room first (new lines scroll at the bottom of the screen), then go back to the cursor, so the saved
    // position stays right when the menu is taller than the space left under the box.
    const col = rl.getCursorPos().cols + 1
    process.stdout.write('\r\n'.repeat(rows.length) + `\x1b[${rows.length}A\x1b[${col}G` + '\x1b7' + (used < box.w - 1 ? `\x1b[${box.w}G` + c.mc('│') : '') +
      rows.map(r => '\r\n\x1b[2K' + r).join('') + '\x1b[0J\x1b8')
  }
  const setLine = (value: string) => {
    const r = rl as unknown as { line: string; cursor: number }
    r.line = value
    r.cursor = value.length
    ;(rl as any)[key!]()
  }

  if (key && original) {
    // The prototype exposes it as a getter, so the override is an own data property, removed again after the prompt.
    Object.defineProperty(rl, key, {
      configurable: true, writable: true,
      value: function (this: Interface, ...args: unknown[]) {
        original.apply(this, args)
        if (active) paint()
      }
    })
  }
  if (menuOn) {
    Object.defineProperty(rl, tkey!, {
      configurable: true, writable: true,
      value: function (this: Interface, s: unknown, k?: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) {
        if (!active) return tty0.call(this, s, k)
        const name = k?.name
        const list = items()
        if (list.length && name === 'escape') { base = null; sel = -1; closedFor = rl.line; paint(); return }
        if (list.length && !k?.ctrl && !k?.meta) {
          if (name === 'tab' || name === 'down' || name === 'up') {
            if (base === null) base = rl.line
            sel = cycle(sel, list.length, name === 'up' || (name === 'tab' && k?.shift) ? -1 : 1)
            setLine(list[sel].value)
            return
          }
          if (name === 'return' || name === 'enter') {
            const act = enterAction(rl.line, list, sel)
            base = null; sel = -1
            if (act.kind === 'fill') { setLine(act.line); return }
            if (act.line !== rl.line) setLine(act.line)
            return tty0.call(this, s, k)
          }
        }
        // Any other key ends the cycle; the menu follows the line as typed again.
        base = null; sel = -1
        const before = rl.line
        tty0.call(this, s, k)
        if (!active) return
        if (rl.line !== before) closedFor = null
        // ↑↓ through history can bring back a '/' line: keep the menu shut for it so the next ↑ is history too.
        if ((name === 'up' || name === 'down') && rl.line !== before) closedFor = rl.line
        paint()
      }
    })
  }
  // On a resize the terminal re-wraps the old top edge (a narrower pane makes it two rows); readline has already
  // redrawn the input line, so go up over the old edge, clear, and draw the whole box again at the new width.
  const onResize = () => {
    if (!key || !original || !fits()) return
    const old = visible(box.top)
    box = edges()
    process.stdout.write(`\r\x1b[${rowsTaken([old])}A\x1b[0J` + box.top + '\r\n')
    ;(rl as any)[key]()
  }
  process.stdout.on('resize', onResize)
  const extra: string[] = []
  const onLine = (line: string) => extra.push(line)
  rl.on('line', onLine)
  let first: string
  try {
    first = await new Promise<string>(resolve => rl.question(PROMPT(), a => { active = false; resolve(a) }))
    // A multi-line paste arrives as several lines at once; the rest come in right after the first.
    await new Promise(resolve => setTimeout(resolve, 40))
  } finally {
    active = false
    process.stdout.off('resize', onResize)
    rl.off('line', onLine)
    rl.pause()
    if (key && original) delete (rl as any)[key]
    if (menuOn) delete (rl as any)[tkey!]
  }
  const answer = unframe([first, ...extra]).join('\n').trim()

  // Replace the typed line(s), bottom edge and hint or menu with the request wrapped inside the box (the clear to
  // the end of the screen also erases any menu rows, so they never reach the scrollback).
  box = edges()
  const { w, bottom } = box
  const cols = process.stdout.columns || 100
  const rows = Math.max(1, Math.ceil(visible(PROMPT() + first) / cols)) + extra.reduce((n, l) => n + Math.max(1, Math.ceil(visible(l) / cols)), 0)
  process.stdout.write(`\x1b[${rows}F\x1b[0J`)
  const inner = w - 4
  const lines = answer ? wrap(answer, inner - 2) : ['']
  lines.slice(0, 30).forEach((line, i) => {
    const lead = i === 0 ? c.mc(c.bold('›')) + ' ' : '  '
    console.log(c.mc('│') + ' ' + pad(lead + line, inner) + ' ' + c.mc('│'))
  })
  if (lines.length > 30) console.log(c.mc('│') + ' ' + pad(c.dim(`  … ${lines.length - 30} more lines`), inner) + ' ' + c.mc('│'))
  console.log(bottom)
  return answer
}
