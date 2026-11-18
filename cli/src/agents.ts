import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { codexTaskArgs } from '../../src/shared/codexTask'
import type { Side } from './plan'

/**
 * One piece of progress from an agent:
 *  tool      a tool call ("Edit src/a.ts", "$ npm test"); `detail` holds "+3 −1" for edits
 *  output    the result of the last command, or of a tool that failed (`ok` false)
 *  text      something the agent says
 *  thinking  reasoning text when the CLI shows it, or just a token count (`tokens`) when it doesn't
 *  todo      the agent's current step from its to-do list; `detail` is "2/5"
 *  usage     output tokens so far (`tokens`)
 *  error / info
 */
export interface AgentEvent {
  kind: 'tool' | 'output' | 'text' | 'thinking' | 'todo' | 'usage' | 'error' | 'info'
  text: string
  detail?: string
  ok?: boolean
  tokens?: number
  context?: number
}

export interface AgentResult {
  ok: boolean
  /** The agent's final reply. */
  text: string
  error?: string
  sessionId?: string
  costUsd?: number
  /** Input + output tokens (Codex). */
  tokens?: number
  /** Input tokens served from cache (Codex). */
  cached?: number
  contextTokens?: number
  contextWindow?: number
  ms: number
}

export function contextWindowFor(side: 'claude' | 'codex', model?: string): number {
  return side === 'codex' ? 272_000 : /\[1m\]|-1m/i.test(model ?? '') ? 1_000_000 : 200_000
}

function promptTokens(usage: any): number | undefined {
  const values = [usage?.input_tokens, usage?.cache_read_input_tokens, usage?.cache_creation_input_tokens]
  return values.some(n => typeof n === 'number' && Number.isFinite(n))
    ? values.reduce((sum, n) => sum + (typeof n === 'number' && Number.isFinite(n) ? n : 0), 0) : undefined
}

export type Access = 'plan' | 'edit' | 'full'

export interface RunOptions {
  side: Side
  cwd: string
  prompt: string
  access: Access
  model?: string
  /** Continue this session instead of starting a new one (its context is cached, so the prompt can be short). */
  resume?: string
  onEvent: (e: AgentEvent) => void
}

const running = new Set<ChildProcess>()

/** Finds a command on PATH the way Windows does (PATHEXT), so npm's .cmd shims are found too. */
export function which(command: string): string | undefined {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const file = join(dir, command + ext.toLowerCase())
      if (existsSync(file)) return file
    }
  }
  return undefined
}

function command(side: Side): { file: string; prefix: string[] } {
  const path = which(side)
  if (!path) throw new Error(`${side} was not found on PATH. Install the ${side === 'claude' ? 'Claude Code' : 'Codex'} CLI first.`)
  if (/\.(cmd|bat)$/i.test(path)) return { file: 'cmd.exe', prefix: ['/c', path] }
  return { file: path, prefix: [] }
}

/** The CLIs must not think they run inside another Claude Code session (when mc itself is started from one). */
function agentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PREVIEW_.*)$/.test(key)) continue
    env[key] = value
  }
  return env
}

/** Commands Claude may run without asking in the default access level: read-only git and the usual test/build checks. */
const CLAUDE_SAFE = [
  'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npm.cmd test:*)', 'Bash(npm.cmd run:*)', 'Bash(npx tsc:*)', 'Bash(npx vitest:*)',
  'Bash(node --test:*)', 'Bash(pnpm test:*)', 'Bash(yarn test:*)', 'Bash(pytest:*)', 'Bash(python -m pytest:*)',
  'Bash(go test:*)', 'Bash(cargo test:*)', 'Bash(cargo check:*)',
  // Running the project's own scripts (no more than npm run already allows) and read-only helpers used to check output.
  'Bash(node:*)', 'Bash(tail:*)', 'Bash(head:*)', 'Bash(cat:*)', 'Bash(ls:*)', 'Bash(wc:*)', 'Bash(echo:*)', 'Bash(rg:*)'
]

export function claudeArgs(access: Access, sessionId: string, model?: string, resume?: string): string[] {
  const mode = access === 'plan' ? 'plan' : access === 'full' ? 'bypassPermissions' : 'acceptEdits'
  return ['-p', '--output-format', 'stream-json', '--verbose', ...(resume ? ['--resume', resume] : ['--session-id', sessionId]), '--permission-mode', mode,
    ...(access === 'full' ? [] : ['--allowedTools', ...CLAUDE_SAFE]), ...(model ? ['--model', model] : [])]
}

export function codexArgs(access: Access, model?: string, resume?: string): string[] {
  return codexTaskArgs(access === 'plan' ? 'plan' : access === 'full' ? 'bypassPermissions' : 'acceptEdits', model, resume)
}

function short(value: unknown, max = 160): string {
  const line = String(value ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

/** Multi-line text kept as lines (agent messages and reasoning are shown wrapped, not squashed into one line). */
function lines(value: unknown, max = 4000): string {
  const textValue = String(value ?? '').replace(/\r\n/g, '\n').trim()
  return textValue.length > max ? textValue.slice(0, max - 1) + '…' : textValue
}

const countLines = (value: unknown) => (typeof value === 'string' && value ? value.replace(/\n$/, '').split('\n').length : 0)

/** Codex on Windows wraps commands as powershell.exe -Command '…'; show just the command. */
export function unwrapShell(command: string): string {
  const m = /^"?[^"]*?powershell(?:\.exe)?"?\s+(?:-NoProfile\s+)?-Command\s+(['"])([\s\S]*)\1\s*$/i.exec(command.trim())
  return m ? m[2] : command
}

/** Paths inside the working folder are shown relative to it (case-insensitive, either slash). */
export function relativeTo(cwd: string, text: string): string {
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return text
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(escaped + '/', 'gi'), '')
}

/** Claude's tool calls as one readable line: "Edit src/app.ts", "$ npm test". */
export function describeClaudeTool(name: string, input: any): string {
  const i = input ?? {}
  // A leading `cd "<worktree>" &&` is just Claude making sure it's in the right folder.
  if (name === 'Bash' || name === 'PowerShell') return `$ ${short(String(i.command ?? '').replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, ''), 400)}`
  const path = i.file_path ?? i.notebook_path ?? i.path
  if (path) return `${name} ${short(String(path).replace(/\\/g, '/'), 400)}`
  if (i.pattern) return `${name} ${short(i.pattern, 400)}`
  if (i.url) return `${name} ${short(i.url, 400)}`
  if (i.query) return `${name} ${short(i.query, 400)}`
  if (i.description) return `${name}: ${short(i.description, 400)}`
  return name
}

/** Lines added and removed by an edit tool, as "+3 −1". */
export function editSize(name: string, input: any): string | undefined {
  const i = input ?? {}
  if (name === 'Write' && typeof i.content === 'string') return `+${countLines(i.content)}`
  if (name === 'Edit' && typeof i.new_string === 'string') return `+${countLines(i.new_string)} −${countLines(i.old_string)}`
  if (name === 'MultiEdit' && Array.isArray(i.edits)) {
    const add = i.edits.reduce((n: number, e: any) => n + countLines(e?.new_string), 0)
    const del = i.edits.reduce((n: number, e: any) => n + countLines(e?.old_string), 0)
    return `+${add} −${del}`
  }
  return undefined
}

/** One line that says how a command went: the error if it failed, otherwise its last line (usually the summary). */
export function outputSummary(output: string, ok: boolean): string {
  // Claude Code adds its own notice after commands that change folder; it says nothing about the result.
  const all = String(output ?? '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^Shell cwd was reset to /.test(l))
  if (!all.length) return ok ? 'done' : 'failed'
  const pick = ok ? all[all.length - 1] : all.find(l => /error|fail|✗|exception|not found|denied/i.test(l)) ?? all[all.length - 1]
  return short(pick, 200) + (all.length > 1 ? ` (${all.length} lines)` : '')
}

function todoEvent(items: Array<{ text: string; done: boolean; active?: boolean }>): AgentEvent | undefined {
  if (!items.length) return undefined
  const done = items.filter(i => i.done).length
  const now = items.find(i => i.active) ?? items.find(i => !i.done) ?? items[items.length - 1]
  return { kind: 'todo', text: short(now.text, 200), detail: `${done}/${items.length}` }
}

interface ClaudeState { tools: Map<string, string>; output: Map<string, number> }
const claudeState = new WeakMap<AgentResult, ClaudeState>()

/** Applies one stream-json line from `claude -p` to the result; returns progress to show. */
export function claudeEvent(e: any, result: AgentResult): AgentEvent[] {
  let st = claudeState.get(result)
  if (!st) claudeState.set(result, st = { tools: new Map(), output: new Map() })
  const out: AgentEvent[] = []
  result.contextWindow ??= contextWindowFor('claude', e?.model ?? e?.message?.model)
  if (e?.type === 'system' && e.subtype === 'init' && typeof e.model === 'string') result.contextWindow = contextWindowFor('claude', e.model)
  // Result usage can be cumulative. Prefer the last assistant's prompt measurement.
  // A subagent's (Task tool) turns carry parent_tool_use_id and their own, separate context.
  const context = e?.type === 'assistant' && !e.parent_tool_use_id ? promptTokens(e.message?.usage)
    : e?.type === 'result' && result.contextTokens === undefined ? promptTokens(e.usage) : undefined
  if (context !== undefined) result.contextTokens = context
  if (e?.type === 'system' && e.subtype === 'init' && e.session_id) result.sessionId = e.session_id
  // Claude Code hides the thinking text in -p mode but reports how much it's thinking.
  if (e?.type === 'system' && e.subtype === 'thinking_tokens' && typeof e.estimated_tokens === 'number') {
    out.push({ kind: 'thinking', text: '', tokens: e.estimated_tokens })
  }
  if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
    for (const block of e.message.content) {
      if (block?.type === 'tool_use') {
        st.tools.set(block.id, block.name)
        if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
          const ev = todoEvent(block.input.todos.map((t: any) => ({ text: String(t.activeForm || t.content || ''), done: t.status === 'completed', active: t.status === 'in_progress' })))
          if (ev) out.push(ev)
          continue
        }
        const size = editSize(block.name, block.input)
        out.push({ kind: 'tool', text: describeClaudeTool(block.name, block.input), ...(size ? { detail: size } : {}) })
      } else if (block?.type === 'text' && block.text?.trim()) out.push({ kind: 'text', text: lines(block.text) })
      else if (block?.type === 'thinking' && block.thinking?.trim()) out.push({ kind: 'thinking', text: lines(block.thinking, 1200) })
    }
    const usage = e.message?.usage
    if (e.message?.id && typeof usage?.output_tokens === 'number') {
      st.output.set(e.message.id, usage.output_tokens)
      out.push({ kind: 'usage', text: '', tokens: [...st.output.values()].reduce((a, b) => a + b, 0), ...(context !== undefined ? { context } : {}) })
    }
  }
  if (e?.type === 'user' && Array.isArray(e.message?.content)) {
    for (const block of e.message.content) {
      if (block?.type !== 'tool_result') continue
      const name = st.tools.get(block.tool_use_id) ?? ''
      const failed = Boolean(block.is_error)
      if (!failed && name !== 'Bash' && name !== 'PowerShell') continue
      const body = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((x: any) => x?.text ?? '').join('\n') : ''
      out.push({ kind: 'output', text: outputSummary(body, !failed), ok: !failed })
    }
  }
  if (e?.type === 'result') {
    result.text = String(e.result ?? '')
    result.costUsd = typeof e.total_cost_usd === 'number' ? e.total_cost_usd : result.costUsd
    if (e.session_id) result.sessionId = e.session_id
    if (e.is_error || e.subtype !== 'success') result.error = short(e.result || e.subtype || 'Claude stopped with an error', 400)
    else result.ok = true
  }
  if (context !== undefined && !out.some(ev => ev.kind === 'usage')) out.push({ kind: 'usage', text: '', context })
  return out
}

/** Codex results that got an exact last-call prompt size from a token_count event. */
const measured = new WeakSet<AgentResult>()

/** Applies one `codex exec --json` line to the result; returns progress to show. */
export function codexEvent(e: any, result: AgentResult): AgentEvent[] {
  const out: AgentEvent[] = []
  result.contextWindow ??= contextWindowFor('codex')
  const tokenEvent = e?.type === 'token_count' ? e : e?.payload?.type === 'token_count' ? e.payload : undefined
  const info = tokenEvent?.info
  const window = info?.model_context_window ?? tokenEvent?.model_context_window ?? e?.model_context_window
  if (typeof window === 'number' && Number.isFinite(window) && window > 0) result.contextWindow = window
  const context = info?.last_token_usage?.input_tokens
  if (typeof context === 'number' && Number.isFinite(context)) {
    measured.add(result)
    result.contextTokens = context
    out.push({ kind: 'usage', text: '', context })
  }
  if (e?.type === 'thread.started') result.sessionId = e.thread_id
  const item = e?.item
  if (item?.type === 'todo_list' && Array.isArray(item.items) && /^item\.(started|updated|completed)$/.test(e.type)) {
    const ev = todoEvent(item.items.map((t: any) => ({ text: String(t.text ?? ''), done: Boolean(t.completed) })))
    if (ev) out.push(ev)
  }
  if (e?.type === 'item.started' && item) {
    if (item.type === 'command_execution') out.push({ kind: 'tool', text: `$ ${short(unwrapShell(String(item.command ?? '')), 400)}` })
    else if (item.type === 'mcp_tool_call') out.push({ kind: 'tool', text: `${item.server ?? 'mcp'}.${item.tool ?? 'tool'}` })
    else if (item.type === 'web_search') out.push({ kind: 'tool', text: `Search ${short(item.query, 400)}` })
  }
  if (e?.type === 'item.completed' && item) {
    if (item.type === 'agent_message') { result.text = String(item.text ?? ''); out.push({ kind: 'text', text: lines(item.text) }) }
    else if (item.type === 'reasoning' && String(item.text ?? '').trim()) out.push({ kind: 'thinking', text: lines(String(item.text).replace(/\*\*/g, ''), 1200) })
    else if (item.type === 'file_change' && Array.isArray(item.changes)) {
      for (const c of item.changes) out.push({ kind: 'tool', text: `${c.kind === 'add' ? 'Write' : c.kind === 'delete' ? 'Delete' : 'Edit'} ${short(String(c.path ?? '').replace(/\\/g, '/'), 400)}` })
    } else if (item.type === 'command_execution') {
      const ok = item.exit_code === 0 || item.exit_code == null
      const summary = outputSummary(String(item.aggregated_output ?? ''), ok)
      out.push({ kind: 'output', text: ok ? summary : `exit ${item.exit_code} · ${summary}`, ok })
    } else if (item.type === 'error' && item.message) out.push({ kind: 'error', text: short(item.message, 400) })
  }
  if (e?.type === 'turn.completed') {
    result.ok = !result.error
    const u = e.usage
    if (u) {
      // turn.completed sums every model call in the turn; a token_count's last-call size is the real prompt size.
      if (!measured.has(result) && typeof u.input_tokens === 'number' && Number.isFinite(u.input_tokens)) result.contextTokens = u.input_tokens
      result.tokens = (result.tokens ?? 0) + (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
      result.cached = (result.cached ?? 0) + (u.cached_input_tokens ?? 0)
      out.push({ kind: 'usage', text: '', tokens: u.output_tokens ?? 0, ...(result.contextTokens !== undefined ? { context: result.contextTokens } : {}) })
    }
  }
  if (e?.type === 'error' || e?.type === 'turn.failed') {
    result.error = short(e.message ?? e.error?.message ?? 'Codex stopped with an error', 400)
    result.ok = false
  }
  return out
}

/** Runs one headless turn of Claude or Codex in `cwd`, streaming progress; the prompt goes in on stdin. */
export function runAgent(o: RunOptions): Promise<AgentResult> {
  const started = Date.now()
  const result: AgentResult = { ok: false, text: '', ms: 0, contextWindow: contextWindowFor(o.side, o.model) }
  const { file, prefix } = command(o.side)
  const sessionId = o.resume ?? randomUUID()
  const args = [...prefix, ...(o.side === 'claude' ? claudeArgs(o.access, sessionId, o.model, o.resume) : codexArgs(o.access, o.model, o.resume))]
  if (o.side === 'claude' || o.resume) result.sessionId = sessionId
  return new Promise(resolve => {
    const child = spawn(file, args, { cwd: o.cwd, env: agentEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    running.add(child)
    let buffer = '', stderr = ''
    child.stdin.on('error', err => { stderr += err.message })
    child.stdin.end(o.prompt)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let e: unknown
        try { e = JSON.parse(line) } catch { continue }
        for (const ev of o.side === 'claude' ? claudeEvent(e, result) : codexEvent(e, result)) o.onEvent({ ...ev, text: relativeTo(o.cwd, ev.text) })
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
    const done = (code: number | null, err?: Error) => {
      if (!running.delete(child)) return
      result.ms = Date.now() - started
      if (err) result.error = err.message
      else if (!result.ok && !result.error) result.error = stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `${o.side} exited with code ${code}`
      if (result.error) result.ok = false
      resolve(result)
    }
    child.on('error', err => done(null, err))
    child.on('close', code => done(code))
  })
}

/** Stops every agent still running (Ctrl+C), including their child processes. */
export function stopAll(): void {
  for (const child of running) {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
    else child.kill()
  }
}
