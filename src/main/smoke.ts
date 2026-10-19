import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import type { HookEvent, TerminalInfo, TerminalSpec } from '../shared/types'
import { listProjects, listSessions } from './claudeData'

interface SmokeDeps {
  launchTerminal: (spec: TerminalSpec) => TerminalInfo
  ptyTaps: Set<{ data?: (id: string, d: string) => void; exit?: (id: string, code: number) => void }>
  hookTaps: Set<(e: HookEvent) => void>
}

const log = (...a: unknown[]) => console.log('[smoke]', ...a)
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '').trim()

/** Runs a claude terminal to completion through the real launch path; returns its output and hook events. */
function runClaude(deps: SmokeDeps, spec: TerminalSpec): Promise<{ output: string; hooks: HookEvent[]; info: TerminalInfo }> {
  return new Promise((resolve) => {
    let output = ''
    const hooks: HookEvent[] = []
    let info: TerminalInfo
    const hookTap = (e: HookEvent) => info && e.agentId === info.id && hooks.push(e)
    const tap = {
      data: (id: string, d: string) => {
        if (info && id === info.id) output += d
      },
      exit: (id: string) => {
        if (!info || id !== info.id) return
        // Hooks are separate curl processes; give the last ones a moment to land.
        setTimeout(() => done(), 1500)
      }
    }
    const done = () => {
      deps.ptyTaps.delete(tap)
      deps.hookTaps.delete(hookTap)
      resolve({ output: stripAnsi(output), hooks, info })
    }
    deps.ptyTaps.add(tap)
    deps.hookTaps.add(hookTap)
    info = deps.launchTerminal(spec)
    setTimeout(done, 90_000)
  })
}

/**
 * Self-test, run with MC_SMOKE=<output.png>. Scans projects, runs claude in a PTY, screenshots, quits.
 * With MC_SMOKE_HOOKS=<folder>, also sends one tiny real prompt there to check hook events end to end.
 */
export async function runSmoke(win: BrowserWindow, outFile: string, deps: SmokeDeps): Promise<void> {
  try {
    const projects = await listProjects()
    log('projects:', projects.length)
    const withSessions = projects.find((p) => p.key)
    if (withSessions) {
      const sessions = await listSessions(withSessions.key)
      log('sessions in', withSessions.name, ':', sessions.length, '-', sessions[0]?.title)
    }

    const version = await runClaude(deps, { cwd: process.cwd(), args: ['--version'], kind: 'claude', cols: 100, rows: 20 })
    log('pty output:', JSON.stringify(version.output))

    const hookDir = process.env.MC_SMOKE_HOOKS
    if (hookDir) {
      const run = await runClaude(deps, {
        cwd: hookDir,
        args: ['-p', 'Reply with exactly the word: pong'],
        kind: 'claude',
        cols: 100,
        rows: 20
      })
      log('prompt output:', JSON.stringify(run.output.slice(0, 200)))
      log('assigned session id:', run.info.sessionId)
      log('hook events:', run.hooks.map((h) => `${h.event}${h.sessionId === run.info.sessionId ? '' : ` (session ${h.sessionId})`}`))
    }

    await new Promise((r) => setTimeout(r, 2000))
    const image = await win.webContents.capturePage()
    writeFileSync(outFile, image.toPNG())
    log('screenshot:', outFile)
  } catch (e) {
    log('FAILED', e)
  } finally {
    app.quit()
  }
}
