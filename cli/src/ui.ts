import { createInterface, type Completer, type Interface } from 'node:readline'
import type { AgentEvent } from './agents'
import { NAME, type Side } from './plan'

const tty = Boolean(process.stdout.isTTY)
const color = tty && !process.env.NO_COLOR
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)

export const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  claude: paint('38;5;173'),
  codex: paint('38;5;75'),
  mc: paint('38;5;141')
}

/** Real terminal columns (boxes and live rows must never wrap, or redrawing breaks). */
const columns = () => Math.max(40, process.stdout.columns || 100)
const width = () => Math.max(60, Math.min(columns(), 160))
/** Width of cards and the input box. */
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

export function tag(side: Side | 'mc'): string {
  const label = side === 'mc' ? 'mc' : side
  return c[side](c.bold(label.padEnd(6)))
}

/** One progress line under an agent's tag, cut to the terminal width. */
export function agentLine(side: Side, phase: string, e: AgentEvent): void {
  const icon = e.kind === 'tool' ? (FILE_TOOL.test(e.text) ? '✎' : '›') : e.kind === 'error' ? '✗' : e.kind === 'info' ? '·' : '“'
  const prefix = `${tag(side)} ${c.dim(phase.padEnd(6))} ${icon} `
  const body = cut(e.text, width() - 18)
  const line = e.kind === 'error' ? c.red(body) : e.kind === 'text' ? body : c.dim(body)
  console.log(prefix + line)
}

export function say(text: string): void {
  console.log(`${tag('mc')} ${text}`)
}

export function heading(text: string): void {
  console.log('\n' + c.mc(c.bold(`── ${text} `)) + c.mc('─'.repeat(Math.max(4, boxWidth() - text.length - 4))))
}

export function block(text: string, indent = '   '): void {
  for (const line of text.split(/\r?\n/)) console.log(indent + line)
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
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

const FILE_TOOL = /^(Edit|Write|MultiEdit|NotebookEdit|Delete) (.+)$/
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface Row {
  side: Side
  phase: string
  now: string
  started: number
  tools: number
  files: Set<string>
  state: 'run' | 'ok' | 'fail'
  ms?: number
}

/**
 * One live row per agent at the bottom of the terminal (spinner, what it's doing now, timer, counts), repainted in
 * place. Only what matters scrolls by above it: files changed, what the agent says, and errors.
 * Without a terminal (piped output) every event is printed as a line, like before.
 */
export class Live {
  private rows: Row[] = []
  private drawn = 0
  private frame = 0
  private timer?: ReturnType<typeof setInterval>

  start(side: Side, phase: string): void {
    this.rows.push({ side, phase, now: 'starting…', started: Date.now(), tools: 0, files: new Set(), state: 'run' })
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
    if (!tty) { agentLine(side, row.phase, e); return }
    if (e.kind === 'tool') {
      row.tools++
      row.now = e.text
      const file = FILE_TOOL.exec(e.text)
      if (file && !row.files.has(file[2])) { row.files.add(file[2]); this.print(side, row.phase, e) }
    } else if (e.kind === 'text') {
      row.now = 'thinking…'
      this.print(side, row.phase, e)
    } else if (e.kind === 'error') this.print(side, row.phase, e)
    else row.now = e.text
  }

  finish(side: Side, ok: boolean, ms: number): void {
    const row = this.rows.find(r => r.side === side && r.state === 'run')
    if (!row) return
    row.state = ok ? 'ok' : 'fail'
    row.ms = ms
    this.repaint()
  }

  /** Clears the live rows and leaves one final line per agent in the scrollback. */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); releaseInput() }
    this.timer = undefined
    if (tty) {
      this.clear()
      for (const r of this.rows) {
        if (r.state === 'run') { r.state = 'fail'; r.now = 'stopped'; r.ms = Date.now() - r.started }
        console.log(this.line(r))
      }
      process.stdout.write('\x1b[?25h')
    }
    this.rows = []
  }

  private print(side: Side, phase: string, e: AgentEvent): void {
    this.clear()
    agentLine(side, phase, e)
    this.draw()
  }

  private clear(): void {
    if (this.drawn) process.stdout.write(`\x1b[${this.drawn}F\x1b[0J`)
    this.drawn = 0
  }

  private draw(): void {
    if (!this.rows.length) return
    process.stdout.write(this.rows.map(r => this.line(r)).join('\n') + '\n')
    this.drawn = this.rows.length
  }

  private repaint(): void {
    this.clear()
    this.draw()
  }

  private line(r: Row): string {
    const max = columns() - 1
    const icon = r.state === 'ok' ? c.green('✓') : r.state === 'fail' ? c.red('✗') : c[r.side](SPIN[this.frame % SPIN.length])
    const left = `  ${icon} ${c[r.side](c.bold(NAME[r.side].padEnd(7)))}${c.dim(r.phase.padEnd(7))}`
    const counts = [duration(r.ms ?? Date.now() - r.started), `${r.tools} tool${r.tools === 1 ? '' : 's'}`, ...(r.files.size ? [`${r.files.size} file${r.files.size === 1 ? '' : 's'}`] : [])].join(' · ')
    const right = c.dim(counts)
    const room = max - visible(left) - visible(right) - 2
    const status = r.state === 'run' ? r.now : r.state === 'ok' ? 'done' : r.now === 'stopped' ? 'stopped' : 'failed'
    const middle = cut(status, Math.max(0, room))
    const text = r.state === 'fail' ? c.red(middle) : r.state === 'ok' ? c.green(middle) : middle
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

/** While agents run, hand the console back to cooked mode so Ctrl+C is a real signal and typing doesn't echo into the live rows. */
function holdInput(): void {
  if (session && process.stdin.isTTY) { session.pause(); process.stdin.setRawMode(false) }
}
function releaseInput(): void {
  if (session && process.stdin.isTTY) process.stdin.setRawMode(true)
}

/** Asks one question. Only answers at the main prompt go in the ↑ history (`remember`), not y/n or one-key answers. */
export async function ask(question: string, remember = false): Promise<string> {
  if (!process.stdin.isTTY) return ''
  if (session) {
    const rl = session
    const answer = await new Promise<string>(resolve => rl.question(question, resolve))
    rl.pause()
    const history = (rl as unknown as { history?: string[] }).history
    if (!remember && answer.trim() && history?.[0] === answer) history.shift()
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

const PROMPT = () => c.mc('│') + ' ' + c.mc(c.bold('mc ›')) + ' '

/**
 * The input box: a framed prompt with the current settings in its top edge. Once submitted, the box is closed around
 * what was typed, so the scrollback reads like a chat.
 */
export async function promptBox(status: string): Promise<string> {
  const w = boxWidth()
  const label = `mc · ${status} `
  const fill = Math.max(1, w - visible(`╭─ ${label}`) - 1)
  console.log(c.mc('╭─ ') + c.mc(c.bold('mc')) + c.dim(` · ${status} `) + c.mc('─'.repeat(fill) + '╮'))
  const answer = await ask(PROMPT(), true)
  if (tty) {
    // Replace the typed line(s) with the request wrapped inside the box.
    const rows = Math.max(1, Math.ceil(visible(PROMPT() + answer) / columns()))
    process.stdout.write(`\x1b[${rows}F\x1b[0J`)
    const inner = w - 4
    const lines = answer.trim() ? wrap(answer.trim(), inner - 5) : ['']
    lines.forEach((line, i) => {
      const lead = i === 0 ? c.mc(c.bold('mc ›')) + ' ' : '     '
      console.log(c.mc('│') + ' ' + pad(lead + line, inner) + ' ' + c.mc('│'))
    })
    console.log(c.mc('╰' + '─'.repeat(w - 2) + '╯'))
  }
  return answer
}
