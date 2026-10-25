/**
 * The terminal host (ADR 0018): a separate background process (Electron utilityProcess) that owns
 * every pseudo console. Windows' ConPTY can block the thread that closes a console while its
 * program is still printing; here that can only hold up this process, never the window. The main
 * process stops the programs and terminates this process on quit, which skips the clean-up that
 * waits.
 */
import { spawn as spawnChild } from 'node:child_process'
import * as pty from '@lydell/node-pty'

export type HostRequest =
  | { type: 'spawn'; id: string; file: string; args: string[]; cwd: string; cols: number; rows: number; env: Record<string, string> }
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'kill'; id: string }

export type HostEvent =
  | { type: 'spawned'; id: string; pid: number }
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; code: number; error?: string }

const port = process.parentPort
const terminals = new Map<string, pty.IPty>()
const send = (e: HostEvent) => port.postMessage(e)

function killTree(pid: number): void {
  spawnChild('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
}

/**
 * node-pty's kill() stops reading output and then closes the console, which ConPTY answers by
 * waiting for output nobody reads if the program is still printing. So the program (and what it
 * started) is stopped first; node-pty drains the rest of the output and reports the exit; only
 * then is the console closed.
 */
function close(id: string): void {
  const proc = terminals.get(id)
  if (!proc) return
  let exited = false
  proc.onExit(() => {
    exited = true
    try {
      proc.kill()
    } catch {
      /* already closed */
    }
  })
  killTree(proc.pid)
  setTimeout(() => !exited && killTree(proc.pid), 3000)
}

port.on('message', (e: { data: HostRequest }) => {
  const m = e.data
  if (m.type === 'spawn') {
    try {
      const proc = pty.spawn(m.file, m.args, { name: 'xterm-256color', cwd: m.cwd, cols: m.cols, rows: m.rows, env: m.env })
      terminals.set(m.id, proc)
      send({ type: 'spawned', id: m.id, pid: proc.pid })
      proc.onData((data) => send({ type: 'data', id: m.id, data }))
      proc.onExit(({ exitCode }) => {
        terminals.delete(m.id)
        send({ type: 'exit', id: m.id, code: exitCode })
      })
    } catch (err) {
      send({ type: 'exit', id: m.id, code: -1, error: (err as Error).message })
    }
  } else if (m.type === 'write') {
    terminals.get(m.id)?.write(m.data)
  } else if (m.type === 'resize') {
    try {
      terminals.get(m.id)?.resize(m.cols, m.rows)
    } catch {
      /* the program may have just exited */
    }
  } else if (m.type === 'kill') {
    close(m.id)
  }
})
