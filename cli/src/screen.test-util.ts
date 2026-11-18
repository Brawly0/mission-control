/** Small VT screen oracle. Wrapped rows retain their logical-line identity on resize. */
type Line = { text: string; wrapped: boolean }
export class Screen {
  lines: Line[] = [{ text: '', wrapped: false }]
  x = 0
  y = 0
  cursorShown = true
  private saved = [0, 0]
  private normal?: { lines: Line[]; x: number; y: number }
  constructor(public cols: number, public rows: number) {}
  private get top() { return Math.max(0, this.lines.length - this.rows) }
  get visible() { return this.lines.slice(this.top).map(l => l.text).join('\n') }
  get scrollback() { return this.lines.slice(0, this.top).map(l => l.text).join('\n') }
  get text() { return this.lines.map(l => l.text).join('\n') }
  private down(wrapped = false) {
    this.y++
    if (!this.lines[this.y]) this.lines.push({ text: '', wrapped })
    if (this.normal && this.lines.length > this.rows) { this.lines.shift(); this.y-- }
  }
  write(data: string) {
    for (let i = 0; i < data.length;) {
      const csi = /^\x1b\[([?\d;]*)([A-Za-z])/.exec(data.slice(i))
      if (csi) {
        i += csi[0].length
        const [, raw, op] = csi
        const n = Number(raw) || 1
        if (raw === '?25') this.cursorShown = op === 'h'
        else if (raw === '?1049') {
          if (op === 'h' && !this.normal) {
            this.normal = { lines: this.lines, x: this.x, y: this.y }
            this.lines = [{ text: '', wrapped: false }]; this.x = this.y = 0
          } else if (op === 'l' && this.normal) {
            Object.assign(this, this.normal); this.normal = undefined
          }
        } else if (op === 'A' || op === 'F') { this.y = Math.max(this.top, this.y - n); if (op === 'F') this.x = 0 }
        else if (op === 'B') this.y = Math.min(this.top + this.rows - 1, this.y + n)
        else if (op === 'G') this.x = n - 1
        else if (op === 'H') { const [r, c] = raw.split(';').map(Number); this.y = this.top + (r || 1) - 1; this.x = (c || 1) - 1 }
        else if (op === 'K' && raw === '2') this.lines[this.y] = { text: '', wrapped: false }
        else if (op === 'J') {
          if (raw === '2') { this.lines = this.lines.slice(0, this.top).concat(Array.from({ length: this.rows }, () => ({ text: '', wrapped: false }))) }
          else { this.lines[this.y] ??= { text: '', wrapped: false }; this.lines[this.y].text = this.lines[this.y].text.slice(0, this.x); this.lines.splice(this.y + 1) }
        }
        continue
      }
      if (data.startsWith('\x1b7', i)) { this.saved = [this.x, this.y]; i += 2; continue }
      if (data.startsWith('\x1b8', i)) { [this.x, this.y] = this.saved; i += 2; continue }
      const ch = String.fromCodePoint(data.codePointAt(i)!)
      i += ch.length
      if (ch === '\r') { this.x = 0; continue }
      // PTYs translate LF to CRLF (ONLCR).
      if (ch === '\n') { this.x = 0; this.down(); continue }
      if (this.x >= this.cols) { this.x = 0; this.down(true) }
      const row = this.lines[this.y] ??= { text: '', wrapped: false }
      row.text = row.text.padEnd(this.x, ' ').slice(0, this.x) + ch + row.text.slice(this.x + 1)
      this.x++
    }
  }
  resize(cols: number, rows: number) {
    const reflow = (lines: typeof this.lines, x: number, y: number) => {
      const logical: string[] = []
      let cursorLine = 0, cursorOffset = 0
      lines.forEach((line, i) => {
        if (!line.wrapped || !logical.length) logical.push('')
        if (i === y) { cursorLine = logical.length - 1; cursorOffset = logical[cursorLine].length + x }
        logical[logical.length - 1] += line.text
      })
      const out: typeof this.lines = []
      let cy = 0, cx = 0
      logical.forEach((line, i) => {
        if (i === cursorLine) { cy = out.length + Math.floor(cursorOffset / cols); cx = cursorOffset % cols }
        for (let j = 0; j < Math.max(1, line.length); j += cols) out.push({ text: line.slice(j, j + cols), wrapped: j > 0 })
      })
      while (out.length <= cy) out.push({ text: '', wrapped: false })
      return { lines: out, x: cx, y: cy }
    }
    if (this.normal) {
      this.normal = reflow(this.normal.lines, this.normal.x, this.normal.y)
      this.lines = this.lines.slice(0, rows).map(l => ({ ...l, text: l.text.slice(0, cols) }))
      this.y = Math.min(this.y, rows - 1); this.x = Math.min(this.x, cols - 1)
    } else Object.assign(this, reflow(this.lines, this.x, this.y))
    this.cols = cols; this.rows = rows
  }
}
