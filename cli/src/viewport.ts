import { cutVisible } from './tree'

// Only permanent output belongs in the normal buffer. A transient frame must never
// enter scrollback: after a height shrink there is no VT command to erase it there.
const history: string[] = []
let active: Viewport | undefined
const sync = (text: string) => process.stdout.write('\x1b[?2026h' + text + '\x1b[?2026l')
function remember(text: string): void {
  history.push(...text.split('\n'))
  if (history.length > 500) history.splice(0, history.length - 500)
}

export function log(...values: unknown[]): void {
  const text = values.join(' ')
  remember(text)
  if (active) active.append(text)
  else process.stdout.write(text + '\n')
}

export function clearHistory(): void { history.length = 0 }

export class Viewport {
  private lines: string[] = []
  private cursor?: { row: number; col: number }
  private closed = false
  private browsing = false
  constructor() {
    active = this
    sync('\x1b[?1049h\x1b[?25l')
  }
  private code(): string {
    const height = Math.max(1, process.stdout.rows || 24)
    const width = Math.max(1, (process.stdout.columns || 100) - 1)
    const lines = this.lines.slice(0, height).map(l => cutVisible(l, width))
    const context = history.slice(-Math.max(0, height - lines.length))
    if (lines.length >= height) context.length = 0
    const all = [...context, ...lines].map(l => cutVisible(l, width))
    const cursor = this.cursor
      ? `\x1b[${context.length + Math.min(lines.length - 1, this.cursor.row) + 1};${Math.min(width, this.cursor.col) + 1}H\x1b[?25h`
      : '\x1b[?25l'
    return '\x1b[H\x1b[0J' + all.join('\r\n') + cursor
  }
  draw(lines: string[], cursor?: { row: number; col: number }): void {
    if (this.closed) return
    this.lines = lines; this.cursor = cursor
    if (!this.browsing) sync(this.code())
  }
  browse(back: boolean): void {
    if (this.closed || this.browsing === back) return
    this.browsing = back
    sync(back ? '\x1b[?1049l\x1b[?25h' : '\x1b[?1049h' + this.code())
  }
  append(text: string): void {
    if (this.closed) return
    // Commit events immediately, then restore the transient projection atomically.
    if (this.browsing) process.stdout.write(text + '\n')
    else sync('\x1b[?1049l' + text + '\n\x1b[?1049h' + this.code())
  }
  close(lines: string[] = []): void {
    if (this.closed) return
    this.closed = true
    active = undefined
    if (lines.length) remember(lines.join('\n'))
    sync((this.browsing ? '' : '\x1b[?1049l') + (lines.length ? lines.join('\n') + '\n' : '') + '\x1b[?25h')
  }
}

export function restoreScreen(): void { active?.close() }
export function browseHistory(back: boolean): void { active?.browse(back) }
