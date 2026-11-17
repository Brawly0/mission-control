/**
 * The live work tree: while the agents run, mc draws what each one is doing as an animated tree of boxes.
 *
 *   ✦ mc · build · 2 running · 23 steps · 5 files changed · aura mood
 *   ·•●  ╭─ ⠹ CLAUDE ────────╮  ●•·      ·•●  ╭─ ⠼ CODEX ─────────╮  ●•·
 *        │ 12 steps · 3 files │                │ 11 steps · 2 files │
 *        ╰──┬─────────────────╯                ╰──┬─────────────────╯
 *           ├─ ┏━ src/cli ━━━━━━┓                 └─ ╭─ terminal ──────╮
 *           ●  ┃ ✎ ui.ts      ⠹ ┃                    │ $ npm test    ✓ │
 *           │  ┗━━━━━━━━━━━━━━━━┛                    ╰─────────────────╯
 *         ↳ Editing ui.ts▌                         ↳ Running npm test
 *
 * Everything here is pure (state in, lines out) so it is unit-tested; ui.ts owns the timer and the terminal.
 */
import type { Side } from './plan'

export type Aura = 'mood' | 'violet' | 'ocean' | 'sunset' | 'matrix' | 'gold' | 'ice' | 'fire' | 'rainbow'
export const AURAS: Aura[] = ['mood', 'violet', 'ocean', 'sunset', 'matrix', 'gold', 'ice', 'fire', 'rainbow']

export type ItemKind = 'read' | 'edit' | 'cmd' | 'search' | 'web' | 'tool'
type GroupKind = 'folder' | 'terminal' | 'search' | 'web' | 'connector'
type State = 'run' | 'ok' | 'fail'

export interface TreeItem { label: string; kind: ItemKind; state: State; at: number; doneAt?: number }
export interface TreeGroup { key: string; kind: GroupKind; label: string; items: TreeItem[]; at: number; last: number }

export interface AgentTree {
  side: Side
  phase: string
  state: State
  started: number
  ms?: number
  groups: TreeGroup[]
  steps: number
  changed: string[]
  tokens: number
  thinking?: number
  /** The frame the last step finished (the green pulse runs back up) and whether it failed (red mood for a moment). */
  doneAt?: number
  failAt?: number
  bornAt: number
}

// ── Colours ─────────────────────────────────────────────────────────────────

const colorOn = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const fg = (n: number) => (s: string) => (colorOn ? `\x1b[38;5;${n}m${s}\x1b[0m` : s)
const bold = (s: string) => (colorOn ? `\x1b[1m${s}\x1b[22m` : s)
const dim = (s: string) => (colorOn ? `\x1b[2m${s}\x1b[22m` : s)
const SIDE: Record<Side, number> = { claude: 173, codex: 75 }
const MOOD: Record<ItemKind | 'error' | 'idle', number> = { read: 75, edit: 220, cmd: 114, search: 111, web: 159, tool: 141, error: 203, idle: 141 }
const FIXED: Record<Exclude<Aura, 'mood' | 'rainbow'>, number> = { violet: 141, ocean: 39, sunset: 209, matrix: 46, gold: 220, ice: 159, fire: 202 }
const RAINBOW = [196, 208, 226, 46, 51, 33, 129, 201]
const GREEN = 114, RED = 203, WHITE = 231

/** The aura colour right now: fixed, cycling (rainbow), or following what the agent is doing (mood). */
export function auraColor(aura: Aura, tree: AgentTree | undefined, frame: number, offset = 0): number {
  if (aura === 'rainbow') return RAINBOW[Math.floor(frame / 2 + offset) % RAINBOW.length]
  if (aura !== 'mood') return FIXED[aura]
  if (!tree) return MOOD.idle
  if (tree.failAt !== undefined && frame - tree.failAt < 12) return MOOD.error
  const item = activeItem(tree)
  return item ? MOOD[item.kind] : tree.thinking !== undefined ? MOOD.tool : MOOD.idle
}

// ── State ───────────────────────────────────────────────────────────────────

export function newTree(side: Side, phase: string, frame: number): AgentTree {
  return { side, phase, state: 'run', started: Date.now(), groups: [], steps: 0, changed: [], tokens: 0, bornAt: frame }
}

const FILE = /^(Read|Edit|Write|MultiEdit|NotebookEdit|Delete) (.+)$/

/** Which box a tool call belongs in, and what to call it there. */
export function classify(text: string): { kind: GroupKind; key: string; label: string; item: string; itemKind: ItemKind } {
  if (text.startsWith('$ ')) return { kind: 'terminal', key: 'terminal', label: 'terminal', item: text, itemKind: 'cmd' }
  const file = FILE.exec(text)
  if (file) {
    const path = file[2].replace(/\\/g, '/').replace(/\s+[+−-]\d.*$/, '')
    const slash = path.lastIndexOf('/')
    const folder = slash > 0 ? path.slice(0, slash) : '.'
    return { kind: 'folder', key: 'dir:' + folder.toLowerCase(), label: folder === '.' ? './' : folder + '/', item: slash > 0 ? path.slice(slash + 1) : path, itemKind: file[1] === 'Read' ? 'read' : 'edit' }
  }
  const space = text.indexOf(' ')
  const name = space < 0 ? text : text.slice(0, space).replace(/:$/, '')
  const rest = space < 0 ? '' : text.slice(space + 1)
  if (name === 'Grep' || name === 'Glob' || name === 'LS') return { kind: 'search', key: 'search', label: 'search', item: rest || name, itemKind: 'search' }
  if (name === 'WebFetch' || name === 'WebSearch' || name === 'Search') {
    const host = /^https?:\/\/([^/]+)/.exec(rest)?.[1]
    return { kind: 'web', key: 'web', label: 'web', item: host ?? rest, itemKind: 'web' }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name) ?? /^([\w-]+)\.([\w-]+)$/.exec(name)
  if (mcp) return { kind: 'connector', key: 'mcp:' + mcp[1], label: mcp[1], item: mcp[2].replace(/_/g, ' '), itemKind: 'tool' }
  return { kind: 'connector', key: 'tools', label: 'tools', item: rest ? `${name} ${rest}` : name, itemKind: 'tool' }
}

function close(tree: AgentTree, state: State, frame: number): void {
  for (const g of tree.groups) for (const it of g.items) if (it.state === 'run') { it.state = state; it.doneAt = frame }
}

/** A tool call: the previous step is done, a box (and an item in it) appears or lights up. */
export function addTool(tree: AgentTree, text: string, frame: number): void {
  if (tree.groups.some(g => g.items.some(i => i.state === 'run'))) { close(tree, 'ok', frame); tree.doneAt = frame }
  const c = classify(text)
  let g = tree.groups.find(x => x.key === c.key)
  if (!g) tree.groups.push(g = { key: c.key, kind: c.kind, label: c.label, items: [], at: frame, last: frame })
  g.last = frame
  const existing = g.items.find(i => i.label === c.item)
  if (existing) { existing.state = 'run'; existing.kind = c.itemKind === 'edit' ? 'edit' : existing.kind; existing.doneAt = undefined; g.items.splice(g.items.indexOf(existing), 1); g.items.push(existing) }
  else g.items.push({ label: c.item, kind: c.itemKind, state: 'run', at: frame })
  tree.steps++
  tree.thinking = undefined
  if (c.itemKind === 'edit') {
    const path = c.label === './' ? c.item : c.label + c.item
    if (!tree.changed.includes(path)) tree.changed.push(path)
  }
}

/** The result of the running step (a command's exit, a failed tool). */
export function addOutput(tree: AgentTree, ok: boolean, frame: number): void {
  close(tree, ok ? 'ok' : 'fail', frame)
  tree.doneAt = frame
  if (!ok) tree.failAt = frame
}

export function finishTree(tree: AgentTree, ok: boolean, ms: number, frame: number): void {
  close(tree, ok ? 'ok' : 'fail', frame)
  tree.state = ok ? 'ok' : 'fail'
  tree.ms = ms
  tree.doneAt = frame
  tree.thinking = undefined
}

function activeItem(tree: AgentTree): TreeItem | undefined {
  for (let i = tree.groups.length - 1; i >= 0; i--) {
    const it = tree.groups[i].items.find(x => x.state === 'run')
    if (it) return it
  }
  return undefined
}

const VERB: Record<ItemKind, string> = { read: 'Reading', edit: 'Editing', cmd: 'Running', search: 'Searching', web: 'Browsing', tool: 'Using' }

/** "↳ Editing ui.ts" */
export function activity(tree: AgentTree): string {
  if (tree.state !== 'run') return tree.state === 'ok' ? 'done' : 'failed'
  if (tree.thinking !== undefined) return `Thinking…${tree.thinking ? ` ~${tree.thinking} tokens` : ''}`
  const it = activeItem(tree)
  if (!it) return tree.steps ? 'Thinking…' : 'Starting…'
  return `${VERB[it.kind]} ${it.label.replace(/^\$ /, '')}`
}

/** The one line a finished tree collapses to. */
export function summary(tree: AgentTree, name: string, duration: string): string {
  const icon = tree.state === 'ok' ? fg(GREEN)('✦') : fg(RED)('✗')
  const files = tree.changed.length
  const changed = files ? ` · changed ${tree.changed.slice(0, 3).map(p => p.split('/').pop()).join(', ')}${files > 3 ? ` +${files - 3}` : ''}` : ''
  const word = tree.state === 'ok' ? 'done' : 'stopped'
  return `  ${icon} ${fg(SIDE[tree.side])(bold(name))} ${dim(tree.phase)} ${word} · ${duration} · ${tree.steps} step${tree.steps === 1 ? '' : 's'} · ${files} file${files === 1 ? '' : 's'}${changed}`
}

// ── Drawing ─────────────────────────────────────────────────────────────────

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const len = (s: string) => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length
const fit = (s: string, w: number) => { const ch = [...s]; return ch.length > w ? ch.slice(0, Math.max(0, w - 1)).join('') + '…' : s + ' '.repeat(w - ch.length) }
const padTo = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - len(s)))

/** A label with a bright sweep running across it (the shine on a working box). */
function shine(label: string, frame: number, color: number): string {
  const ch = [...label]
  const at = (frame % (ch.length + 8)) - 4
  return ch.map((x, i) => (Math.abs(i - at) <= 1 ? bold(fg(WHITE)(x)) : fg(color)(x))).join('')
}

/** Names type themselves in: a new label is revealed two characters per frame. */
const typed = (label: string, born: number, frame: number) => [...label].slice(0, Math.max(1, (frame - born) * 2)).join('')

interface BoxStyle { heavy: boolean; color: number; frame: number; run: boolean; done?: number; failed?: boolean }

/**
 * A box around content lines (already `iw` wide), with a title in its top edge. A working box has heavy borders with
 * a bright segment running around them and sparks rising up its sides; a box that just finished glows green with
 * sparkles in its corners.
 */
function box(title: string, content: string[], iw: number, s: BoxStyle): string[] {
  const w = iw + 4
  const [h, v, tl, tr, bl, br] = s.heavy ? ['━', '┃', '┏', '┓', '┗', '┛'] : ['─', '│', '╭', '╮', '╰', '╯']
  const fresh = s.done !== undefined && s.frame - s.done < 10
  const sparkle = fresh && s.frame % 4 < 2 ? '✦' : undefined
  const corner = (c: string) => sparkle ?? c
  const top = [corner(tl), h, ' ', ...[...title].map(() => '\0'), ' ', ...Array(Math.max(0, w - len(title) - 5)).fill(h), corner(tr)]
  const per = 2 * w + 2 * content.length
  const hi = s.frame % per
  const lit = (i: number) => s.run && ((i - hi + per) % per) < 5
  const base = s.failed ? RED : !s.run ? (fresh ? GREEN : 240) : s.color
  const paint = (ch: string, i: number) => (lit(i) ? bold(fg(WHITE)(ch)) : fg(base)(ch))
  let titleDone = false
  const topLine = top.map((ch, i) => {
    if (ch !== '\0') return paint(ch, i)
    if (titleDone) return ''
    titleDone = true
    return title
  }).join('')
  const out = [topLine]
  content.forEach((line, r) => {
    const spark = s.run && (r + s.frame) % 4 === 0
    const left = spark ? fg(s.color)(s.heavy ? '╏' : '┆') : paint(v, 2 * w + 2 * content.length - 1 - r)
    const right = spark ? fg(s.color)(s.heavy ? '╏' : '┆') : paint(v, w + r)
    out.push(left + ' ' + padTo(line, iw) + ' ' + right)
  })
  const bottom = [corner(bl), ...Array(w - 2).fill(h), corner(br)]
  out.push(bottom.map((ch, i) => paint(ch, w + content.length + (w - 1 - i))).join(''))
  return out
}

function itemLine(it: TreeItem, iw: number, frame: number, color: number): string {
  const icon = it.kind === 'edit' ? '✎' : it.kind === 'cmd' ? '$' : it.kind === 'web' ? '◍' : it.kind === 'search' ? '⌕' : it.kind === 'tool' ? '◆' : '▸'
  const mark = it.state === 'run' ? fg(color)(SPIN[frame % SPIN.length]) : it.state === 'ok' ? fg(GREEN)('✓') : fg(RED)('✗')
  const raw = it.label.replace(/^\$ /, '')
  const label = fit(typed(raw, it.at, frame), iw - 4)
  const text = it.state === 'run' ? shine(label, frame, WHITE) : it.state === 'fail' ? fg(RED)(label) : label
  return `${it.kind === 'edit' ? fg(MOOD.edit)(icon) : dim(icon)} ${text} ${mark}`
}

/** Room to show, from roomy to tight: files per box, and how many boxes. */
const DENSITY: Array<{ items: number; groups: number; compact?: boolean }> = [
  { items: 3, groups: 99 }, { items: 3, groups: 4 }, { items: 2, groups: 3 }, { items: 1, groups: 3 }, { items: 1, groups: 2 }, { items: 1, groups: 6, compact: true }, { items: 1, groups: 3, compact: true }
]

/** One agent's column: its box with wings and stars, the trunk with the pulse, the boxes it has touched, its activity. */
function column(tree: AgentTree, name: string, w: number, o: { frame: number; aura: Aura; duration: string; density: (typeof DENSITY)[number]; offset: number }): string[] {
  const { frame } = o
  const color = auraColor(o.aura, tree, frame, o.offset)
  const running = tree.state === 'run'
  const out: string[] = []

  // The agent box: colour around its border, wings of dots pulsing out, stars twinkling at the corners.
  const wing = running ? ['   ·', '  ·•', ' ·•●', '·•●•', '•●• ', '●•  ', '•   ', '    '][frame % 8] : '    '
  const stars = running ? ['✧', '✦', '·', '✦'][Math.floor(frame / 3) % 4] : ' '
  const bw = Math.max(18, w - 10)
  const icon = running ? fg(SIDE[tree.side])(SPIN[frame % SPIN.length]) : tree.state === 'ok' ? fg(GREEN)('✓') : fg(RED)('✗')
  const title = `${icon} ${fg(SIDE[tree.side])(bold(name.toUpperCase()))} ${dim(tree.phase)}`
  const files = tree.changed.length
  const stats = `${tree.steps} step${tree.steps === 1 ? '' : 's'} · ${files} file${files === 1 ? '' : 's'} · ${o.duration}${tree.tokens ? ` · ↓${tree.tokens >= 1000 ? (tree.tokens / 1000).toFixed(1) + 'k' : tree.tokens}` : ''}`
  const auraTag = o.aura === 'mood' ? 'mood' : o.aura
  const inner = padTo(dim(fit(stats, bw - 4 - auraTag.length - 2)), bw - 4 - auraTag.length - 1) + ' ' + fg(color)(auraTag)
  const agent = box(title, [inner], bw - 4, { heavy: running, color, frame, run: running, done: running ? undefined : tree.doneAt, failed: tree.state === 'fail' })
  const lw = fg(color)(wing), rw = fg(color)([...wing].reverse().join(''))
  out.push(` ${fg(color)(stars)}   ${agent[0]}   ${fg(color)(stars)}`)
  out.push(`${lw} ${agent[1]} ${rw}`)
  // The trunk leaves the agent box from its bottom edge.
  const bottom = agent[2]
  out.push(`     ${replaceVisible(bottom, 2, fg(running ? color : 240)(running ? '┳' : '┬'))}`)

  // The boxes it has touched (most recent kept when room is short), each hanging off the trunk.
  let groups = tree.groups
  const hidden = Math.max(0, groups.length - o.density.groups)
  if (hidden) groups = groups.slice(-o.density.groups)
  const gw = Math.max(16, w - 12)
  const rows: Array<{ line: string; branch: boolean; last?: boolean }> = []
  if (hidden) rows.push({ line: dim(`+${hidden} earlier`), branch: true })
  groups.forEach((g, gi) => {
    const active = g.items.some(i => i.state === 'run')
    const failed = !active && g.items.some(i => i.state === 'fail' && i.doneAt !== undefined && frame - i.doneAt < 20)
    const done = Math.max(...g.items.map(i => i.doneAt ?? -1))
    const kindIcon = g.kind === 'folder' ? '▤' : g.kind === 'terminal' ? '❯' : g.kind === 'search' ? '⌕' : g.kind === 'web' ? '◍' : '◆'
    const label = typed(g.label, g.at, frame)
    const titleText = `${kindIcon} ${fit(label, Math.max(4, gw - 10)).trimEnd()}`
    const title = active ? shine(titleText, frame, color) : g.items.every(i => i.state === 'ok') ? `${titleText} ${fg(GREEN)('✓')}` : titleText
    if (o.density.compact) {
      const it = g.items[g.items.length - 1]
      rows.push({ line: `${active ? fg(color)(kindIcon) : dim(kindIcon)} ${fit(g.label, 14)} ${itemLine(it, gw - 16, frame, color)}`, branch: true, last: gi === groups.length - 1 })
      return
    }
    const items = g.items.slice(-o.density.items)
    const more = g.items.length - items.length
    const content = items.map(it => itemLine(it, gw - 4, frame, color))
    if (more) content.push(dim(`+${more} more`))
    const b = box(title, content, gw - 4, { heavy: active, color, frame: frame + gi * 3, run: active, done: active ? undefined : done, failed })
    b.forEach((line, i) => rows.push({ line, branch: i === 0, last: gi === groups.length - 1 && i === 0 }))
  })

  // The trunk, with a pulse running down to the working box (and a green one running back when a step finishes).
  const target = rows.map((r, i) => ({ r, i })).filter(x => x.r.branch).pop()?.i ?? 0
  const activeRow = (() => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].branch && /\x1b\[1m/.test(rows[i].line)) return i
    return target
  })()
  const span = activeRow + 1
  // The pulse runs down to the working box, rests there for a moment, and starts again.
  const step = frame % (span + 3)
  const down = running && step <= activeRow ? step : -9
  const back = tree.doneAt !== undefined && frame - tree.doneAt < span ? activeRow - (frame - tree.doneAt) : -9
  const lastBranch = rows.map((r, i) => (r.branch ? i : -1)).filter(i => i >= 0).pop() ?? -1
  rows.forEach((r, i) => {
    let trunk: string
    if (i === back) trunk = fg(GREEN)('●')
    else if (i === down) trunk = fg(color)('●')
    else if (i === down - 1) trunk = fg(color)('•')
    else if (i === down - 2) trunk = fg(color)('·')
    else if (i > lastBranch) trunk = ' '
    else trunk = dim(r.branch ? (i === lastBranch ? '└' : '├') : '│')
    out.push(`       ${trunk}${r.branch ? dim('─ ') : '  '}${r.line}`)
  })

  // What it's doing right now, with a blinking cursor.
  const cursor = running && frame % 10 < 6 ? fg(color)('▌') : ' '
  out.push(`     ${fg(color)('↳')} ${fit(activity(tree), w - 9)}${cursor}`)
  return out.map(l => padTo(l, w))
}

export interface DrawOptions {
  frame: number
  width: number
  height: number
  aura: Aura
  phase: string
  names: Record<Side, string>
  duration: (tree: AgentTree) => string
}

/** The whole tree: a header line, then one column per agent (side by side when there's room). */
export function renderTree(trees: AgentTree[], o: DrawOptions): string[] {
  const running = trees.filter(t => t.state === 'run').length
  const steps = trees.reduce((n, t) => n + t.steps, 0)
  const files = new Set(trees.flatMap(t => t.changed)).size
  const headColor = auraColor(o.aura, trees.find(t => t.state === 'run') ?? trees[0], o.frame)
  const star = running ? ['✦', '✧', '✦', '·'][Math.floor(o.frame / 3) % 4] : '✦'
  const header = `  ${fg(headColor)(star)} ${bold('mc')} ${dim('·')} ${o.phase} ${dim('·')} ${running ? `${running} running` : 'finished'} ${dim('·')} ${steps} step${steps === 1 ? '' : 's'} ${dim('·')} ${files} file${files === 1 ? '' : 's'} changed ${dim('·')} aura ${fg(headColor)(o.aura)}`
  const sideBySide = trees.length === 2 && o.width >= 84
  const colW = sideBySide ? Math.floor((o.width - 2) / 2) : Math.min(o.width, 72)
  const budget = Math.max(6, o.height - 1)
  for (const density of DENSITY) {
    const cols = trees.map((t, i) => column(t, o.names[t.side], colW, { frame: o.frame, aura: o.aura, duration: o.duration(t), density, offset: i * 3 }))
    const body = sideBySide ? zip(cols[0], cols[1], colW) : cols.flatMap((c, i) => (i ? ['', ...c] : c))
    if (body.length <= budget || density === DENSITY[DENSITY.length - 1]) return [header, ...body.slice(0, budget)].map(l => cutVisible(l, o.width))
  }
  return [header]
}

function zip(a: string[], b: string[], w: number): string[] {
  const n = Math.max(a.length, b.length)
  return Array.from({ length: n }, (_, i) => padTo(a[i] ?? '', w) + '  ' + (b[i] ?? ''))
}

/** Replaces the visible character at `index` in a coloured line. */
function replaceVisible(line: string, index: number, ch: string): string {
  let out = '', n = 0
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) { out += part; continue }
    for (const x of part) { out += n === index ? ch : x; n++ }
  }
  return out
}

/** Cuts a coloured line to `max` visible characters (the tree must never wrap, or repainting breaks). */
export function cutVisible(line: string, max: number): string {
  let out = '', n = 0
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) { out += part; continue }
    for (const ch of part) { if (n >= max) return out + (colorOn ? '\x1b[0m' : ''); out += ch; n++ }
  }
  return out
}
