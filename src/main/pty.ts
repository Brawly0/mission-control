import { terminateProcessTreesSync } from './processCleanup'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { utilityProcess, type UtilityProcess } from 'electron'
import ptyHostPath from './ptyHost?modulePath'
import type { HostEvent, HostRequest } from './ptyHost'
import type { TerminalInfo, TerminalSpec } from '../shared/types'

type Listener = { data: (id: string, data: string) => void; exit: (id: string, code: number) => void }

/** Terminals that are open (closing ones are already gone from here). They live in the terminal host (ptyHost.ts). */
const terminals = new Set<string>()
/** Working folder of each terminal, so a worktree can be freed before it is deleted. */
const terminalCwd = new Map<string, string>()

/** Finds an executable on PATH, honouring PATHEXT the way cmd.exe does. */
export function whichSync(name: string): string | null {
  const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase())
      if (ext && existsSync(candidate)) return candidate
    }
  }
  return null
}

const toolPaths = new Map<string, string | null>()
const INSTALL_HINT = { claude: 'Install Claude Code', codex: 'Install it with: npm i -g @openai/codex' }

function resolveCommand(spec: TerminalSpec): { file: string; args: string[] } {
  // A fresh account need not have Windows PowerShell on PATH.
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (spec.kind === 'shell') return { file: powershell, args: ['-NoLogo'] }
  if (!toolPaths.has(spec.kind)) toolPaths.set(spec.kind, whichSync(spec.kind))
  const path = toolPaths.get(spec.kind)
  if (!path) {
    // Don't remember a miss: installing it while the app runs should work on the next tab.
    toolPaths.delete(spec.kind)
    // Fall back to a shell that explains what is missing instead of failing silently.
    return {
      file: powershell,
      args: ['-NoLogo', '-NoExit', '-Command', `Write-Host '${spec.kind} was not found on PATH. ${INSTALL_HINT[spec.kind]}, then reopen this tab.' -ForegroundColor Yellow`]
    }
  }
  if (/\.(cmd|bat)$/i.test(path)) return { file: 'cmd.exe', args: ['/c', path, ...spec.args] }
  return { file: path, args: spec.args }
}

/**
 * The environment for agents. If Mission Control itself was started from inside a Claude Code
 * session, that session's host variables (child-session flags, host-managed auth, API base URL)
 * would make every agent behave like its sub-process and fail to authenticate; drop them.
 */
export function agentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  const insideClaude = Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT)
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (insideClaude && /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PREVIEW_.*|ANTHROPIC_BASE_URL)$/.test(key)) {
      continue
    }
    env[key] = value
  }
  env.FORCE_COLOR = '1'
  return env
}

// ---------------------------------------------------------------- the terminal host

let host: UtilityProcess | null = null
const listeners = new Map<string, Listener>()
/** Program pid per terminal, reported by the host once it has started. */
const pids = new Map<string, number>()
/** Exits being waited for (killTerminalsIn). */
const exitWaiters = new Map<string, (() => void)[]>()

function finish(id: string, code: number): void {
  const listener = listeners.get(id)
  listeners.delete(id)
  terminals.delete(id)
  terminalCwd.delete(id)
  pids.delete(id)
  for (const done of exitWaiters.get(id) ?? []) done()
  exitWaiters.delete(id)
  listener?.exit(id, code)
}

/** Starts the terminal host on first use (see ptyHost.ts); if it ever dies, its terminals end and the next one starts a new host. */
function ensureHost(): UtilityProcess {
  if (host) return host
  const child = utilityProcess.fork(ptyHostPath, [], { serviceName: 'Mission Control terminals', stdio: 'ignore' })
  child.on('message', (e: HostEvent) => {
    if (e.type === 'data') listeners.get(e.id)?.data(e.id, e.data)
    else if (e.type === 'spawned') pids.set(e.id, e.pid)
    else if (e.type === 'exit') {
      if (e.error) listeners.get(e.id)?.data(e.id, `\r\n\x1b[31mCould not start: ${e.error}\x1b[0m\r\n`)
      finish(e.id, e.code)
    }
  })
  child.on('exit', () => {
    if (host === child) host = null
    for (const id of [...listeners.keys()]) finish(id, -1)
  })
  host = child
  return child
}

function post(m: HostRequest): void {
  ensureHost().postMessage(m)
}

export function spawnTerminal(spec: TerminalSpec, listener: Listener, id: string = randomUUID()): TerminalInfo {
  const { file, args } = resolveCommand(spec)
  const cwd = existsSync(spec.cwd) ? spec.cwd : (process.env.USERPROFILE ?? process.cwd())
  terminals.add(id)
  terminalCwd.set(id, existsSync(spec.cwd) ? spec.cwd : '')
  listeners.set(id, listener)
  post({ type: 'spawn', id, file, args, cwd, cols: Math.max(spec.cols, 20), rows: Math.max(spec.rows, 5), env: agentEnv() })
  // The program's pid comes from the host a moment later; nothing needs it right away.
  return { id, pid: 0 }
}

export function writeTerminal(id: string, data: string): void {
  if (terminals.has(id)) post({ type: 'write', id, data })
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (cols < 2 || rows < 2 || !terminals.has(id)) return
  post({ type: 'resize', id, cols, rows })
}

/** Closes a terminal: the host stops its program first and closes the console once it has exited. */
export function killTerminal(id: string): void {
  if (!terminals.has(id)) return
  terminals.delete(id)
  post({ type: 'kill', id })
}

/**
 * On quit: stops every terminal's program (and what it started), then terminates the host, which
 * skips the console clean-up that can make Windows wait. Never blocks for more than a few seconds.
 */
export function killAllTerminals(): void {
  const list = [...pids.values()]
  terminals.clear()
  terminalCwd.clear()
  terminateProcessTreesSync(list)
  const child = host
  host = null
  listeners.clear()
  child?.kill()
}

/**
 * Stops every terminal running inside `folder` and waits for them to exit.
 * Windows keeps a folder locked while a process has it as its working directory.
 */
export async function killTerminalsIn(folder: string): Promise<string[]> {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const prefix = norm(folder)
  const ids = [...terminalCwd.entries()]
    .filter(([id, cwd]) => terminals.has(id) && (norm(cwd) === prefix || norm(cwd).startsWith(prefix + '\\')))
    .map(([id]) => id)
  if (ids.length === 0) return []
  const exited = ids.map(
    (id) =>
      new Promise<void>((resolve) => {
        exitWaiters.set(id, [...(exitWaiters.get(id) ?? []), resolve])
        setTimeout(resolve, 3000)
      })
  )
  ids.forEach(killTerminal)
  await Promise.all(exited)
  return ids
}

export function terminalCount(): number {
  return terminals.size
}
