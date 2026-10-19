import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as pty from '@lydell/node-pty'
import type { TerminalInfo, TerminalSpec } from '../shared/types'

type Listener = { data: (id: string, data: string) => void; exit: (id: string, code: number) => void }

const terminals = new Map<string, pty.IPty>()

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

let claudePath: string | null | undefined

function resolveCommand(spec: TerminalSpec): { file: string; args: string[] } {
  if (spec.kind === 'shell') return { file: 'powershell.exe', args: ['-NoLogo'] }
  if (claudePath === undefined) claudePath = whichSync('claude')
  if (!claudePath) {
    // Fall back to a shell that explains what is missing instead of failing silently.
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', "Write-Host 'claude was not found on PATH. Install Claude Code, then reopen this tab.' -ForegroundColor Yellow"]
    }
  }
  if (/\.(cmd|bat)$/i.test(claudePath)) return { file: 'cmd.exe', args: ['/c', claudePath, ...spec.args] }
  return { file: claudePath, args: spec.args }
}

export function spawnTerminal(spec: TerminalSpec, listener: Listener, id: string = randomUUID()): TerminalInfo {
  const { file, args } = resolveCommand(spec)
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cwd: existsSync(spec.cwd) ? spec.cwd : process.env.USERPROFILE,
    cols: Math.max(spec.cols, 20),
    rows: Math.max(spec.rows, 5),
    env: { ...process.env, FORCE_COLOR: '1' } as Record<string, string>
  })
  terminals.set(id, proc)
  proc.onData((data) => listener.data(id, data))
  proc.onExit(({ exitCode }) => {
    terminals.delete(id)
    listener.exit(id, exitCode)
  })
  return { id, pid: proc.pid }
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  if (cols < 2 || rows < 2) return
  try {
    terminals.get(id)?.resize(cols, rows)
  } catch {
    /* process may have just exited */
  }
}

export function killTerminal(id: string): void {
  const proc = terminals.get(id)
  if (!proc) return
  terminals.delete(id)
  try {
    proc.kill()
  } catch {
    /* already gone */
  }
}

export function killAllTerminals(): void {
  for (const id of [...terminals.keys()]) killTerminal(id)
}
