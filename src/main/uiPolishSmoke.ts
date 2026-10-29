import { app, ipcMain, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadStore, updateStore } from './store'
import { listProjects, normalizePath } from './claudeData'
import { createTask, deleteTask, flushTasks, listTasks, setTaskRun } from './tasks'
import { whichSync } from './pty'

/** Read-only visual tour, using the isolated self-test profile and no model calls. */
export async function uiPolishSmoke(win: BrowserWindow, outFile: string, log: (...values: unknown[]) => void) {
  const settings = structuredClone(loadStore().settings)
  const saved = structuredClone(loadStore())
  const oldPath = process.env.PATH
  const fixtureRoot = join(app.getPath('userData'), `polish-${randomUUID()}`)
  const bin = join(fixtureRoot, 'bin')
  const taskIds: string[] = [], agentIds: string[] = []
  const fixtures = [
    { name: 'Polish fixture Alpha', description: 'Polish fixture Alpha', tags: [], tool: 'claude' as const },
    { name: 'Polish fixture Beta', description: 'A useful description of a project with several tools, shared workflows and a deliberately longer explanation to check wrapping.', tags: ['frontend', 'keyboard', 'responsive-layout'], tool: 'codex' as const },
    { name: 'Polish fixture Gamma', description: 'Small utility.', tags: ['tools'], tool: 'claude' as const },
    { name: 'Polish fixture Delta', description: 'Polish fixture Delta', tags: ['one', 'two', 'three', 'four', 'five'], tool: 'codex' as const }
  ].map((p) => ({ ...p, path: join(fixtureRoot, p.name) }))
  const js = async (code: string) => {
    try { return await win.webContents.executeJavaScript(code) }
    catch (e) { throw new Error(`UI script: ${code}\n${String(e)}`) }
  }
  const pause = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms))
  const key = async (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await pause(50)
  }
  const until = async (code: string) => {
    for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(100) }
    throw new Error(`UI condition: ${code}`)
  }
  const shot = async (name: string) => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await win.webContents.capturePage(); await pause()
    writeFileSync(outFile.replace(/\.png$/, `-${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  const input = async (selector: string, value: string, select = false) => {
    await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('${select ? 'change' : 'input'}', { bubbles: true })); })()`)
    await pause()
  }
  const click = async (selector: string, text: string) => {
    await js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`)
    await pause()
  }
  mkdirSync(bin, { recursive: true })
  for (const tool of ['claude', 'codex']) {
    writeFileSync(join(bin, `${tool}.cmd`), `@echo off\r\nif "%~1"=="--version" (echo 0.0.0-polish-fixture& exit /b 0)\r\nif "%~1"=="auth" (echo {"loggedIn":true,"authMethod":"fixture","subscriptionType":"fixture"}& exit /b 0)\r\nif "%~1"=="login" (echo Logged in using fixture& exit /b 0)\r\necho MC_POLISH_${tool}\r\nset /p MC_POLISH_INPUT=Fixture waiting: \r\n`)
  }
  process.env.PATH = `${bin};${oldPath ?? ''}`
  win.show(); win.focus(); win.webContents.setBackgroundThrottling(false)
  try {
    for (const tool of ['claude', 'codex']) {
      if (normalizePath(whichSync(tool) ?? '') !== normalizePath(join(bin, `${tool}.cmd`))) throw new Error(`Polish ${tool} fixture is not first on PATH`)
    }
    for (const p of fixtures) {
      mkdirSync(join(p.path, 'docs'), { recursive: true })
      writeFileSync(join(p.path, 'README.md'), `# ${p.name}\n\n${p.description}\n`)
      writeFileSync(join(p.path, 'docs', 'guide.md'), '# Fixture guide\n\nRead-only polish tour fixture.\n')
    }
    updateStore(s => {
      s.settings.queueEnabled = false
      for (const p of fixtures) {
        s.manualProjects.push(p.path)
        s.projectMeta[normalizePath(p.path)] = { tags: p.tags, notes: '', displayName: p.name, preferredAgent: p.tool }
      }
    })
    // Isolated profiles may live under Temp or a worktree. Keep only our fixture
    // projects visible as ordinary projects, without changing discovery policy.
    ipcMain.removeHandler('projects:list')
    ipcMain.handle('projects:list', async () => (await listProjects()).map(p => fixtures.some(f => normalizePath(f.path) === normalizePath(p.path)) ? { ...p, worktree: false } : p))
    await until('!!window.__mcSmoke')
    await js('window.mc.setZoom(1); window.__mcSmoke.refresh()')
    await js(`window.__mcSmoke.setView('projects')`)
    await until(`!![...document.querySelectorAll('.big-project-name')].find(el => el.textContent.includes(${JSON.stringify(fixtures[0].name)}))`)
    const common = { projectPath: fixtures[0].path, projectName: fixtures[0].name, mode: 'headless' as const, permission: 'plan' as const, useWorktree: false, prompt: 'Display fixture only. Never start.' }
    const todo = createTask({ ...common, title: 'Polish: check board controls' })
    const review = createTask({ ...common, title: 'Polish: review layout' })
    taskIds.push(todo.id, review.id)
    setTaskRun(review.id, { startedAt: Date.now() - 120_000, finishedAt: Date.now() - 60_000, result: 'Local fixture complete.' }, 'review')
    await until(`window.__mcSmoke.tasks().some(t => t.id === ${JSON.stringify(todo.id)})`)
    for (const theme of ['dark', 'light']) {
      await js(`if (document.documentElement.dataset.theme !== '${theme}') window.__mcSmoke.runShortcut('toggleTheme')`)
      await until(`document.documentElement.dataset.theme === '${theme}'`)
      for (const width of [1440, 960]) {
        win.setSize(width, width === 960 ? 640 : 900); await pause(400)
        for (const view of ['home', 'projects', 'tasks', 'search', 'usage']) {
          await js(`window.__mcSmoke.setView('${view}')`); await pause(600)
          if (view === 'projects') {
            await click('.projects-page .segmented button', 'All')
            await js(`document.querySelector('.projects-page [aria-label="Cards"]').click()`)
            await input('.projects-page .toolbar-search input', 'Polish fixture')
            await until(`document.querySelectorAll('.projects-grid .big-project').length === 4`)
            const rows = await js(`(() => {
              const rows = new Map();
              for (const card of document.querySelectorAll('.projects-grid .big-project')) {
                const r = card.getBoundingClientRect(), a = card.querySelector('.big-project-actions').getBoundingClientRect();
                const row = rows.get(r.top) || []; row.push({ height: r.height, bottom: a.bottom }); rows.set(r.top, row);
              }
              return [...rows.values()];
            })()`)
            if (rows.some((row: { height: number; bottom: number }[]) => row.some(c => Math.abs(c.height - row[0].height) > 1 || Math.abs(c.bottom - row[0].bottom) > 1))) throw new Error('Project card rows or action areas are uneven')
            await js(`document.querySelector('.big-project-main').focus()`)
            await key('Tab')
            await until(`document.activeElement === document.querySelector('.big-project-go') && getComputedStyle(document.activeElement).opacity === '1'`)
            if (!await js(`document.querySelector('.big-project-summary').textContent.includes('No chats yet')`)) throw new Error('Repeated project description did not use activity fallback')
          }
          if (view === 'tasks') {
            await click('.tasks-layout-switch button', 'Board')
            await input('.tasks-title-row .project-filter', '', true)
            win.webContents.send('tasks:changed', [])
            await until(`document.querySelectorAll('.board-col').length === 4 && document.querySelectorAll('.col-empty').length === 4 && document.querySelector('.board-notice')?.textContent.includes('Your board is ready')`)
            await shot(`${theme}-${width}-tasks-empty`)
            win.webContents.send('tasks:changed', listTasks())
            await input('.tasks-title-row .project-filter', fixtures[1].path, true)
            await until(`document.querySelector('.board-notice')?.textContent.includes('No tasks for this project')`)
            await shot(`${theme}-${width}-tasks-filtered`)
            await click('.board-notice button', 'Show all projects')
            await until(`document.querySelectorAll('.task-card').length >= 2`)
            const heights = await js(`[...document.querySelectorAll('.tasks-title-row .project-filter, .tasks-head .toolbar > .btn, .tasks-head .queue-control, .tasks-layout-switch')].map(e => e.getBoundingClientRect().height)`)
            if (heights.some((h: number) => Math.abs(h - 38) > 1)) throw new Error(`Task controls differ in height: ${heights}`)
            if (width === 1440 && !await js(`Math.abs(document.querySelector('.project-filter').getBoundingClientRect().top - document.querySelector('.tasks-layout-switch').getBoundingClientRect().top) <= 1`)) throw new Error('Wide Task toolbar is not aligned with the title/filter row')
            if (!await js(`(() => { const row = document.querySelector('.tasks-title-row'); return row.contains(document.querySelector('.project-filter')) && row.scrollWidth <= row.clientWidth + 1 && [...document.querySelectorAll('.tasks-head .toolbar > *')].every(e => { const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; }); })()`)) throw new Error('Task controls clipped')
          }
          if (view === 'search') {
            await input('[aria-label="Search chats"]', '')
            await until(`document.querySelectorAll('.search-examples button').length === 4`)
            await js(`document.querySelector('.search-examples button').focus()`)
            await key('Enter')
            await until(`document.querySelector('[aria-label="Search chats"]').value === 'fix tests' && document.querySelector('.search-results').getAttribute('aria-busy') === 'false'`)
            await input('[aria-label="Search chats"]', '')
          }
          await shot(`${theme}-${width}-${view}`)
          const overflow = await js(`(() => {
            const pane = document.querySelector('.view-pane:not(.hidden)'), top = document.querySelector('.topbar');
            return { view: pane.scrollWidth - pane.clientWidth, top: top.scrollWidth - top.clientWidth };
          })()`)
          log('layout', theme, width, view, overflow)
          if (overflow.top > 1 || overflow.view > 1) throw new Error(`Unexpected overflow in ${view}`)
        }
        // Actual keyboard events: open, navigate, dismiss and restore focus.
        await js(`document.querySelector('.topbar-new').focus()`)
        await key('Down')
        await until(`document.activeElement === document.querySelector('.menu-item:not(:disabled)')`)
        await key('End')
        await until(`document.activeElement === [...document.querySelectorAll('.menu-item:not(:disabled)')].at(-1)`)
        await key('Down')
        await until(`document.activeElement === document.querySelector('.menu-item:not(:disabled)')`)
        await key('Escape')
        await until(`!document.querySelector('.menu[role="menu"]') && document.activeElement === document.querySelector('.topbar-new')`)
        // Put the existing trigger at the bottom edge to exercise upward placement.
        await js(`window.__menuAnchor = document.querySelector('.topbar-new').closest('.menu-anchor'); window.__anchorStyle = window.__menuAnchor.getAttribute('style'); window.__menuAnchor.style.cssText = 'position:fixed;right:8px;bottom:4px;z-index:100'; document.querySelector('.topbar-new').click()`)
        await until(`!!document.querySelector('.menu[role="menu"]')`)
        await pause()
        const fits = await js(`(() => { const r = document.querySelector('.menu[role="menu"]').getBoundingClientRect(), a = window.__menuAnchor.getBoundingClientRect(); return r.top >= 7 && r.left >= 7 && r.right <= innerWidth - 7 && r.bottom <= a.top; })()`)
        if (!fits) throw new Error('Menu clipped at viewport edge')
        await shot(`${theme}-${width}-menu`)
        await key('Tab')
        await until(`!document.querySelector('.menu[role="menu"]')`)
        await js(`if (window.__anchorStyle === null) window.__menuAnchor.removeAttribute('style'); else window.__menuAnchor.setAttribute('style', window.__anchorStyle)`)
        log('menus: keyboard focus, wrapping navigation, Escape, Tab and upward placement passed', theme, width)
        await js('window.__mcSmoke.openSettings()')
        await until('!!document.querySelector(".settings-pane")')
        if (!await js(`[...document.querySelectorAll('.settings-section h3')].map(e => e.textContent).join('|') === 'Profile|Notifications|Window'`)) throw new Error('Missing grouped General settings')
        await shot(`${theme}-${width}-settings`)
        const generalHeight = await js(`document.querySelector('.settings').getBoundingClientRect().height`)
        await click('.settings-tabs button', 'Appearance')
        const shortHeight = await js(`document.querySelector('.settings').getBoundingClientRect().height`)
        if (shortHeight >= generalHeight) throw new Error('Short Settings tab did not size to content')
        await shot(`${theme}-${width}-settings-short`)
        await click('.settings-tabs button', 'General')
        await js('window.mc.setZoom(1.25); void 0')
        await pause(300)
        const fitsSettings = await js(`(() => { const dialog = document.querySelector('.settings'), pane = document.querySelector('.settings-pane'), r = dialog.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && pane.scrollWidth <= pane.clientWidth + 1; })()`)
        if (!fitsSettings) throw new Error(`Settings clipped at 125%: ${theme}/${width}`)
        await js(`document.querySelector('.settings-pane').scrollTop = document.querySelector('.settings-pane').scrollHeight`)
        await shot(`${theme}-${width}-settings-125`)
        await js('window.mc.setZoom(1); void 0')
        await js('document.querySelector(".settings .dialog-head button").click()')
        await until('!document.querySelector(".settings-pane")')
      }
    }
    // The real preferred-provider callback launches only local waiting CLI fixtures.
    for (const p of fixtures.slice(0, 2)) {
      await js(`window.__mcSmoke.setView('projects')`)
      await input('.projects-page .toolbar-search input', p.name)
      await until(`document.querySelectorAll('.big-project-go').length === 1`)
      await js(`document.querySelector('.big-project-main').focus()`)
      await key('Tab')
      await until(`document.activeElement === document.querySelector('.big-project-go') && getComputedStyle(document.activeElement).opacity === '1'`)
      const before: string[] = await js(`window.__mcSmoke.agents().map(a => a.id)`)
      await key('Enter')
      await until(`window.__mcSmoke.agents().some(a => !${JSON.stringify(before)}.includes(a.id))`)
      const agent = await js(`window.__mcSmoke.agents().find(a => !${JSON.stringify(before)}.includes(a.id))`)
      agentIds.push(agent.id)
      if (agent.kind !== p.tool || normalizePath(agent.cwd) !== normalizePath(p.path)) throw new Error('Project New session did not use its preferred provider and folder')
      await js(`window.__mcSmoke.closeAgent(${JSON.stringify(agent.id)})`)
      await until(`!window.__mcSmoke.agents().some(a => a.id === ${JSON.stringify(agent.id)})`)
    }
    log('tasks/projects/settings: empty and filtered boards, aligned controls, equal rows, keyboard actions, preferred providers and grouped content passed')
    await js(`window.__mcSmoke.setView('search')`)
    await until(`!!document.querySelector('[aria-label="Search chats"]')`)
    await js(`(() => { const input = document.querySelector('[aria-label="Search chats"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'MC_NO_MATCH_82734'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    await until(`document.querySelector('.search-results').getAttribute('aria-busy') === 'true'`)
    await until(`document.querySelector('.search-results').getAttribute('aria-busy') === 'false' && document.querySelector('.search-results').textContent.includes('No matches')`)
    await js(`document.querySelector('[aria-label="Search chats"]').focus()`)
    await key('Escape')
    await until(`document.querySelector('.search-results').textContent.includes('Search all your chats') && !document.querySelector('.search-results').textContent.includes('No matches')`)
    log('search: loading, no results and clearing query passed')
    await js(`window.__mcSmoke.setView('knowledge')`)
    await until(`document.querySelectorAll('.kn-doc').length >= 2`)
    for (const index of [0, 1]) {
      await js(`document.querySelectorAll('.kn-doc')[${index}].click()`)
      await until(`!![...document.querySelectorAll('.kn-view .doc-view button')].find(b => b.textContent.trim() === 'Edit' && !b.disabled)`)
      await js(`[...document.querySelectorAll('.kn-view .doc-view button')].find(b => b.textContent.trim() === 'Edit').click()`)
      await until(`!!document.querySelector('.kn-view .doc-editor')`)
      const correct = await js(`(async () => document.querySelector('.kn-view .doc-editor').value === await window.mc.readDoc(document.querySelectorAll('.kn-doc')[${index}].title))()`)
      if (!correct) throw new Error('Document editor shows another file or loading/error text')
      await js(`[...document.querySelectorAll('.kn-view .doc-view button')].find(b => b.textContent.trim() === 'Cancel').click()`)
    }
    await shot('document-reader')
    log('documents: switched files, loaded correct content and cancelled editing without saving')
    await js(`window.mc.setZoom(1.25); void 0`)
    await pause(400)
    await js('window.__mcSmoke.openSettings()')
    await until('!!document.querySelector(".settings-pane")')
    await shot('zoom-125-settings')
    const dialogFits = await js(`(() => { const r = document.querySelector('.settings').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`)
    if (!dialogFits) throw new Error('Settings clipped at 125% zoom')
    log('UI polish tour: PASS')
  } finally {
    ipcMain.removeHandler('projects:list')
    ipcMain.handle('projects:list', () => listProjects())
    for (const id of agentIds) await js(`window.__mcSmoke.closeAgent(${JSON.stringify(id)})`).catch(() => {})
    for (const id of taskIds) await deleteTask(id)
    flushTasks()
    process.env.PATH = oldPath
    await js(`window.mc.setZoom(${settings.uiZoom || 1}); void 0`)
    updateStore(s => { s.settings = settings; s.manualProjects = saved.manualProjects; s.projectMeta = saved.projectMeta })
  }
}
