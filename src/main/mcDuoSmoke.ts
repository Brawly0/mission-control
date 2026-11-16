import type { BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeTerminal } from './pty'
import { ptyTaps } from './terminals'

/**
 * MC_SMOKE_MC: opens the bundled mc duo CLI in a real terminal from the UI (ADR 0042), checks its banner, runs
 * `list` and quits, and screenshots the Home card, the project button and the agent tab in both themes.
 * No model calls: mc only plans when it gets a prompt.
 */
export async function mcDuoSmoke(win: BrowserWindow, outFile: string, log: (...values: unknown[]) => void) {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const pause = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (what: string, test: () => boolean | Promise<boolean>, tries = 150) => {
    for (let i = 0; i < tries; i++) { if (await test()) return; await pause(100) }
    throw new Error(`Timed out waiting for ${what}`)
  }
  const shot = async (name: string) => {
    await js(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    await pause(250)
    writeFileSync(outFile.replace(/\.png$/, `-${name}.png`), (await win.webContents.capturePage()).toPNG())
  }

  const repo = mkdtempSync(join(tmpdir(), 'mc-duo-smoke-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'ignore' })
  git('init', '-q')
  writeFileSync(join(repo, 'README.md'), '# duo smoke\n')
  git('add', '-A')
  git('-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-qm', 'init')

  let output = ''
  let exited: number | undefined
  let mcId = ''
  const tap = {
    data: (id: string, d: string) => { if (!mcId || id === mcId) output += d },
    exit: (id: string, code: number) => { if (!mcId || id === mcId) exited = code }
  }
  ptyTaps.add(tap)
  const plain = () => output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  win.show()
  win.setContentSize(1440, 900)
  try {
    await until('the UI', async () => !!(await js('!!window.__mcSmoke')))
    for (const theme of ['dark', 'light']) {
      await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      await js(`window.__mcSmoke.setView('home')`)
      await until('the mc card on Home', async () => !!(await js(`!!document.querySelector('.hd-launch.hd-tone-mc .mc-logo')`)))
      await shot(`${theme}-home`)
    }
    await js(`document.documentElement.dataset.theme = 'dark'`)

    const info = await js(`window.__mcSmoke.launch({ cwd: ${JSON.stringify(repo)}, projectPath: ${JSON.stringify(repo)}, projectName: 'duo smoke', title: 'duo smoke · mc', kind: 'mc' })`)
    mcId = info.id
    await until('the mc banner', () => plain().includes('on one prompt') && plain().includes('mc ›'))
    if (!plain().includes(repo.slice(-12))) throw new Error('mc did not show the repository it runs in')
    await until('the mc badge', async () => !!(await js(`!!document.querySelector('.agent-tab .mc-logo, .tool-mc, .mc-logo')`)))
    await shot('dark-agent')
    writeTerminal(mcId, 'list\r')
    await until('mc list', () => plain().includes('No runs in this repository yet'))
    writeTerminal(mcId, '\r')
    await until('mc to quit', () => exited !== undefined)
    if (exited !== 0) throw new Error(`mc exited with ${exited}`)
    log('mc duo: banner, list and quit in a real terminal passed')
    log('mc duo smoke: PASS')
  } catch (err) {
    log('mc output:', JSON.stringify(plain().slice(-1500)), 'exit:', exited, 'id:', mcId)
    log('agents:', JSON.stringify(await js('window.__mcSmoke.agents()').catch(() => null)))
    throw err
  } finally {
    ptyTaps.delete(tap)
    try { rmSync(repo, { recursive: true, force: true, maxRetries: 3 }) } catch { /* the terminal may still hold the folder a moment */ }
  }
}
