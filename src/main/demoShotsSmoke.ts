import { BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { loadStore } from './store'
import { ptyTaps } from './terminals'
import { writeTerminal } from './pty'

/**
 * MC_SMOKE_DEMO=<folder for the PNGs>: README screenshots from a demo profile. Start the app with
 * USERPROFILE pointing at a demo home (its .claude/projects holds only demo chats) and
 * MC_DEMO_REAL_HOME at your real home, so the live agents it starts can sign in. Paid: the agents
 * run real Claude prompts in the projects listed in MC_DEMO_AGENTS (`path|prompt` per line).
 */
export async function demoShotsSmoke(win: BrowserWindow, outDir: string, log: (...a: unknown[]) => void): Promise<void> {
  const js = <T = unknown>(code: string): Promise<T> => win.webContents.executeJavaScript(code)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const shot = async (name: string, wait = 1200) => {
    await sleep(wait)
    const file = `${outDir}\\${name}.png`
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('screenshot:', file)
  }
  const key = (keyCode: string, modifiers: ('control' | 'shift' | 'alt')[] = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const click = (selector: string, text: string) =>
    js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim().includes(${JSON.stringify(text)})); b?.click(); return !!b })()`)
  const closeDialogs = () => js(`document.querySelectorAll('.overlay').forEach((o) => o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))`)

  win.setSize(1440, 900)
  win.center()
  win.show()
  win.focus()
  win.webContents.focus()
  win.webContents.setBackgroundThrottling(false)
  for (let i = 0; i < 240 && (await js<{ lastRun: number }>('window.mc.indexStatus()')).lastRun === 0; i++) await sleep(500)
  await js('window.__mcSmoke.refresh()')
  if (loadStore().settings.theme === 'light') key('L', ['control', 'shift'])
  await sleep(1500)

  const projects = await js<{ path: string; name: string }[]>('window.mc.listProjects()')
  log('projects:', projects.map((p) => p.name).join(', '))
  await js(`window.__mcSmoke.setView('home')`)
  await shot('home', 2500)
  await js(`window.__mcSmoke.setView('projects')`)
  await shot('projects')
  const first = projects.find((p) => /trail-tracker/i.test(p.path)) ?? projects[0]
  if (first) {
    await js(`window.__mcSmoke.selectProject(${JSON.stringify(first.path)}); window.__mcSmoke.setView('project')`)
    for (const tab of ['Overview', 'Chats']) {
      await click('.page-tabs button', tab)
      await shot(`project-${tab.toLowerCase()}`, 1500)
    }
  }
  await js(`window.__mcSmoke.setView('usage')`)
  await shot('usage', 2000)
  await js(`window.__mcSmoke.setView('home'); window.__mcSmoke.openPalette()`)
  await shot('palette')
  await closeDialogs()

  // Live agents sign in with your real home; the app's own data stays on the demo home.
  if (process.env.MC_DEMO_REAL_HOME) process.env.USERPROFILE = process.env.MC_DEMO_REAL_HOME
  const specs = (process.env.MC_DEMO_AGENTS ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|'))
  const trusted = new Set<string>()
  const tap = {
    data: (id: string, d: string) => {
      if (!trusted.has(id) && /trust (this|the files)/i.test(d)) {
        trusted.add(id)
        // The prompt's default is "No, exit": move to "Yes, I trust this folder" first.
        setTimeout(() => writeTerminal(id, '\x1b[B'), 800)
        setTimeout(() => writeTerminal(id, '\r'), 1300)
      }
    }
  }
  ptyTaps.add(tap)
  for (const [path, prompt] of specs) {
    const name = path.split('\\').pop()
    await js(`window.__mcSmoke.launch({ kind: 'claude', cwd: ${JSON.stringify(path)}, projectPath: ${JSON.stringify(path)}, projectName: ${JSON.stringify(name)}, title: ${JSON.stringify(name)}, args: [${JSON.stringify(prompt)}], stayInView: true })`)
    await sleep(1500)
  }
  if (specs.length) {
    await js(`window.__mcSmoke.setView('agents')`)
    await sleep(800)
    log('grid button:', await click('button', 'Grid'))
    for (const at of [25, 50, 80]) {
      await sleep(at === 25 ? 25000 : (at === 50 ? 25000 : 30000))
      await shot(`agents-grid-${at}s`, 0)
    }
    await click('button', 'Tabs')
    await shot('agents-tabs', 1500)
    await js(`window.__mcSmoke.setView('home')`)
    await shot('home-live', 2500)
  }
  key('L', ['control', 'shift'])
  await shot('home-light', 2000)
  key('L', ['control', 'shift'])
  ptyTaps.delete(tap)
  for (const a of await js<{ id: string }[]>('window.__mcSmoke.agents()')) await js(`window.__mcSmoke.closeAgent(${JSON.stringify(a.id)})`)
  await sleep(1500)
}
