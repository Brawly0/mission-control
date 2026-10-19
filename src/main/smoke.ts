import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { listProjects, listSessions } from './claudeData'
import { spawnTerminal } from './pty'

/**
 * Headless-ish self-test, run with MC_SMOKE=<output.png>.
 * Scans projects, spawns `claude --version` in a PTY, screenshots the window, then quits.
 */
export async function runSmoke(win: BrowserWindow, outFile: string): Promise<void> {
  const log = (...a: unknown[]) => console.log('[smoke]', ...a)
  try {
    const projects = await listProjects()
    log('projects:', projects.length)
    log('first:', projects.slice(0, 3).map((p) => `${p.name} (${p.sessionCount}) ${p.path}`))
    const withSessions = projects.find((p) => p.key)
    if (withSessions) {
      const sessions = await listSessions(withSessions.key)
      log('sessions in', withSessions.name, ':', sessions.length, '-', sessions[0]?.title)
    }

    const output = await new Promise<string>((resolve) => {
      let buf = ''
      spawnTerminal(
        { cwd: process.cwd(), args: ['--version'], kind: 'claude', cols: 100, rows: 20 },
        { data: (_id, d) => (buf += d), exit: () => resolve(buf) }
      )
      setTimeout(() => resolve(buf + ' [timeout]'), 15000)
    })
    log('pty output:', JSON.stringify(output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()))

    await new Promise((r) => setTimeout(r, 2500))
    const image = await win.webContents.capturePage()
    writeFileSync(outFile, image.toPNG())
    log('screenshot:', outFile)
  } catch (e) {
    log('FAILED', e)
  } finally {
    app.quit()
  }
}
