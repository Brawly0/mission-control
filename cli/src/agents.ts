import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { codexTaskArgs } from '../../src/shared/codexTask'
import type { Side } from './plan'

/** One line of progress from an agent: a tool call, a message, or an error. */
export interface AgentEvent {
  kind: 'tool' | 'text' | 'error' | 'info'
  text: string
}

export interface AgentResult {
  ok: boolean
  /** The agent's final reply. */
  text: string
  error?: string
  sessionId?: string
  costUsd?: number
  tokens?: number
  ms: number
}

export type Access = 'plan' | 'edit' | 'full'

export interface RunOptions {
  side: Side
  cwd: string
  prompt: string
  access: Access
  model?: string
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
  'Bash(go test:*)', 'Bash(cargo test:*)', 'Bash(cargo check:*)'
]

export function claudeArgs(access: Access, sessionId: string, model?: string): string[] {
  const mode = access === 'plan' ? 'plan' : access === 'full' ? 'bypassPermissions' : 'acceptEdits'
  return ['-p', '--output-format', 'stream-json', '--verbose', '--session-id', sessionId, '--permission-mode', mode,
    ...(access === 'full' ? [] : ['--allowedTools', ...CLAUDE_SAFE]), ...(model ? ['--model', model] : [])]
}

export function codexArgs(access: Access, model?: string): string[] {
  return codexTaskArgs(access === 'plan' ? 'plan' : access === 'full' ? 'bypassPermissions' : 'acceptEdits', model)
}

function short(value: unknown, max = 160): string {
  const line = String(value ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

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
  if (name === 'Bash' || name === 'PowerShell') return `$ ${short(i.command, 400)}`
  const path = i.file_path ?? i.notebook_path ?? i.path
  if (path) return `${name} ${short(String(path).replace(/\\/g, '/'), 400)}`
  if (i.pattern) return `${name} ${short(i.pattern, 400)}`
  if (i.url) return `${name} ${short(i.url, 400)}`
  if (i.description) return `${name}: ${short(i.description, 400)}`
  return name
}

/** Applies one stream-json line from `claude -p` to the result; returns progress lines to show. */
export function claudeEvent(e: any, result: AgentResult): AgentEvent[] {
  const out: AgentEvent[] = []
  if (e?.type === 'system' && e.subtype === 'init' && e.session_id) result.sessionId = e.session_id
  if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
    for (const block of e.message.content) {
      if (block?.type === 'tool_use') out.push({ kind: 'tool', text: describeClaudeTool(block.name, block.input) })
      else if (block?.type === 'text' && block.text?.trim()) out.push({ kind: 'text', text: short(block.text) })
    }
  }
  if (e?.type === 'result') {
    result.text = String(e.result ?? '')
    result.costUsd = typeof e.total_cost_usd === 'number' ? e.total_cost_usd : result.costUsd
    if (e.session_id) result.sessionId = e.session_id
    if (e.is_error || e.subtype !== 'success') result.error = short(e.result || e.subtype || 'Claude stopped with an error', 400)
    else result.ok = true
  }
  return out
}

/** Applies one `codex exec --json` line to the result; returns progress lines to show. */
export function codexEvent(e: any, result: AgentResult): AgentEvent[] {
  const out: AgentEvent[] = []
  if (e?.type === 'thread.started') result.sessionId = e.thread_id
  const item = e?.item
  if (e?.type === 'item.started' && item) {
    if (item.type === 'command_execution') out.push({ kind: 'tool', text: `$ ${short(unwrapShell(String(item.command ?? '')), 400)}` })
    else if (item.type === 'mcp_tool_call') out.push({ kind: 'tool', text: `${item.server ?? 'mcp'}.${item.tool ?? 'tool'}` })
    else if (item.type === 'web_search') out.push({ kind: 'tool', text: `Search ${short(item.query, 400)}` })
  }
  if (e?.type === 'item.completed' && item) {
    if (item.type === 'agent_message') { result.text = String(item.text ?? ''); out.push({ kind: 'text', text: short(item.text) }) }
    else if (item.type === 'file_change' && Array.isArray(item.changes)) {
      for (const c of item.changes) out.push({ kind: 'tool', text: `${c.kind === 'add' ? 'Write' : c.kind === 'delete' ? 'Delete' : 'Edit'} ${short(String(c.path ?? '').replace(/\\/g, '/'), 400)}` })
    } else if (item.type === 'command_execution' && item.exit_code) out.push({ kind: 'info', text: `exit ${item.exit_code}` })
  }
  if (e?.type === 'turn.completed') {
    result.ok = !result.error
    const u = e.usage
    if (u) result.tokens = (result.tokens ?? 0) + (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
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
  const result: AgentResult = { ok: false, text: '', ms: 0 }
  const { file, prefix } = command(o.side)
  const sessionId = randomUUID()
  const args = [...prefix, ...(o.side === 'claude' ? claudeArgs(o.access, sessionId, o.model) : codexArgs(o.access, o.model))]
  if (o.side === 'claude') result.sessionId = sessionId
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
