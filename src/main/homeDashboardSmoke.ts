import { app, ipcMain, type BrowserWindow } from 'electron'
import type { DashboardActivity, DashboardDay } from '../shared/types'
import { queryIndex } from './indexer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { listProjects, normalizePath } from './claudeData'
import { loadStore, updateStore } from './store'
import { createTask, deleteTask, flushTasks, listTasks, setTaskRun } from './tasks'
import { whichSync } from './pty'
import { ptyTaps } from './terminals'

/** Native Home regression tour. All launched CLIs are local fixtures, never models. */
export async function homeDashboardSmoke(win: BrowserWindow, outFile: string, log: (...values: unknown[]) => void) {
  const saved = structuredClone(loadStore())
  const originalPath = process.env.PATH
  const fixture = join(app.getPath('userData'), `home-dashboard-${randomUUID()}`)
  const bin = join(fixture, 'bin'), scratch = join(fixture, 'dashboard-workspace')
  const taskIds: string[] = [], ownedAgents: string[] = []
  const output = new Map<string, string>()
  const tap = { data: (id: string, data: string) => output.set(id, (output.get(id) ?? '') + data) }
  const js = async (code: string): Promise<any> => {
    try { return await win.webContents.executeJavaScript(code) }
    catch (error) { throw new Error(`Home UI script failed: ${code}\n${String(error)}`) }
  }
  const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (code: string, attempts = 150) => {
    for (let i = 0; i < attempts; i++) { if (await js(code)) return; await pause() }
    throw new Error(`Home UI condition timed out: ${code}`)
  }
  const clickText = async (selector: string, text: string) => {
    await until(`!![...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`)
    await js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`)
  }
  const home = async () => {
    await js(`window.__mcSmoke.openTask(null); window.__mcSmoke.setView('home')`)
    await until(`!!document.querySelector('.view-pane:not(.hidden) .home.hd')`)
  }
  const key = async (keyCode: string) => {
    win.focus()
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await pause(60)
  }
  const shot = async (name: string) => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await pause(150)
    const file = /\.png$/i.test(outFile) ? outFile.replace(/\.png$/i, `-${name}.png`) : `${outFile}-${name}.png`
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    log('home screenshot', file)
  }

  win.show(); win.focus(); win.webContents.setBackgroundThrottling(false)
  mkdirSync(bin, { recursive: true }); mkdirSync(scratch, { recursive: true })
  writeFileSync(join(scratch, 'README.md'), '# Dashboard smoke workspace\nA local fixture for Home navigation and provider routing.\n')
  for (const tool of ['claude', 'codex']) {
    writeFileSync(join(bin, `${tool}.cmd`), [
      '@echo off',
      'if "%~1"=="--version" (echo 0.0.0-home-fixture& exit /b 0)',
      'if "%~1"=="auth" (echo {"loggedIn":true,"authMethod":"fixture","subscriptionType":"fixture"}& exit /b 0)',
      'if "%~1"=="login" (echo Logged in using fixture& exit /b 0)',
      `echo MC_HOME_FIXTURE_${tool.toUpperCase()}`,
      'set /p MC_HOME_FIXTURE_INPUT=Fixture waiting for input: ',
      'exit /b 0', ''
    ].join('\r\n'))
  }
  process.env.PATH = `${bin};${originalPath ?? ''}`
  ptyTaps.add(tap)
  try {
    await until('!!window.__mcSmoke')
    if (await js(`window.__mcSmoke.agents().some(a => a.kind === 'claude' || a.kind === 'codex')`)) throw new Error('Home provider smoke requires a fresh isolated process with no existing provider terminals.')
    for (const tool of ['claude', 'codex']) {
      if (normalizePath(whichSync(tool) ?? '') !== normalizePath(join(bin, `${tool}.cmd`))) throw new Error(`Home smoke ${tool} fixture did not take precedence on PATH`)
    }
    updateStore(s => {
      s.manualProjects = [...new Set([...s.manualProjects, scratch])]
      s.projectMeta[normalizePath(scratch)] = { tags: [], notes: '', displayName: 'Dashboard workspace', status: 'active', preferredAgent: 'codex' }
    })
    const existing = (await listProjects()).find(project => !project.worktree && project.path !== scratch)
    const selected = existing?.path ?? scratch
    await js('window.__mcSmoke.refresh()')
    await js(`window.__mcSmoke.selectProject(${JSON.stringify(selected)}); window.__mcSmoke.setView('home'); window.mc.setZoom(1)`)
    await until(`document.querySelectorAll('.home.hd .hd-launch').length === 5 && document.querySelectorAll('.home.hd .hd-stat').length >= 4 && document.querySelectorAll('.home.hd .hd-grid > .hd-panel').length === 6`)
    await until(`(async () => { const status = await window.mc.indexStatus(); return !status.indexing && !!status.lastRun })()`, 600)
    const indexed = await js(`(async () => ({ status: await window.mc.indexStatus(), activity: await window.mc.dashboardActivity() }))()`)
    if (indexed.status.sessions > 0 && indexed.activity.sessions <= 0) throw new Error('Completed nonempty index returned no dashboard activity')
    log('home indexed activity', indexed.activity.sessions, 'sessions', indexed.activity.activeDays, 'days', indexed.activity.activeMinutes, 'estimated minutes')
    await until(`!document.querySelector('.hd-activity .hd-heatmap[aria-busy="true"]')`)

    // Override only the read endpoint in this isolated no-model smoke process.
    // Native SQLite aggregation has its own regression tests; these fixtures prove presentation.
    const today = new Date(), monday = new Date(today)
    monday.setDate(today.getDate() - (today.getDay() + 6) % 7)
    const old = new Date(monday); old.setDate(old.getDate() - 7)
    const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const row = (date: Date, tool: 'claude' | 'codex', activeMinutes: number, events = 2): DashboardDay => ({ day: dateKey(date), tool, activeMinutes, events, sessions: 1 })
    const history = row(old, 'claude', 120)
    const fixtureData = (days: DashboardDay[]): DashboardActivity => ({ days, sessions: days.length, activeDays: new Set(days.map(d => d.day)).size, activeMinutes: days.reduce((n, d) => n + d.activeMinutes, 0) })
    let response: () => Promise<DashboardActivity> = async () => fixtureData([history])
    ipcMain.removeHandler('index:dashboard')
    ipcMain.handle('index:dashboard', () => response())
    const reload = async () => {
      await js(`window.__mcSmoke.setView('usage')`)
      await until(`!document.querySelector('.view-pane:not(.hidden) .home.hd')`)
      await home()
    }
    await reload()
    await until(`document.querySelector('.hd-usage-total').textContent.includes('No activity in this period')`)
    await until(`document.querySelector('.hd-summary').textContent.includes('2h')`)
    if (await js(`document.querySelectorAll('.hd-heatmap').length !== 1 || !!document.querySelector('.hd-spark, .hd-spark-bars, .hd-launch-arrow') || document.querySelector('.hd-stats').textContent.includes('-100%') || !!document.querySelector('.hd-week-bars')`)) throw new Error('Historical-only Home fabricated a trend or duplicated visualizations')
    await clickText('.hd-tabs[aria-label="Usage period"] button', 'All Time')
    await until(`document.querySelector('.hd-usage-total').textContent.includes('2h') && document.querySelector('.hd-usage .hd-period').textContent.includes('All indexed history')`)
    await clickText('.hd-tabs[aria-label="Usage period"] button', 'This Week')
    await until(`document.querySelector('.hd-usage-total').textContent.includes('No activity in this period')`)
    if (await js(`window.__mcSmoke.tasks().every(t => t.column === 'done') && window.__mcSmoke.agents().every(a => a.exited)`)) {
      await until(`!!document.querySelector('.hd-idle') && document.querySelectorAll('.hd-stats .hd-stat').length === 4`)
      for (const label of ['View tasks', 'View agents']) { await clickText('.hd-idle-actions button', label); await until(`!document.querySelector('.view-pane:not(.hidden) .home.hd')`); await home() }
    }
    // Empty-period copy and the combined idle card must fit in both themes and widths.
    for (const theme of ['dark', 'light']) {
      await js(`if (document.documentElement.dataset.theme !== '${theme}') window.__mcSmoke.runShortcut('toggleTheme')`)
      for (const [width, height] of [[1440, 900], [960, 720]]) {
        win.setSize(width, height); await pause(350)
        const overflow = await js(`[...document.querySelectorAll('.home.hd, .hd-grid > .hd-panel, .hd-stat, .hd-launch')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className)`)
        if (overflow.length) throw new Error(`Empty Home overflow at ${theme}/${width}: ${JSON.stringify(overflow)}`)
        await shot(`home-empty-${theme}-${width}`)
      }
    }
    response = async () => fixtureData([])
    await reload()
    await until(`document.querySelector('.hd-usage-total').textContent.includes('No activity in this period') && document.querySelector('.hd-summary dd').textContent === '0'`)
    response = async () => fixtureData([history, row(today, 'claude', 30)])
    await reload()
    await until(`document.querySelector('.hd-usage-total').textContent.includes('30m') && document.querySelector('.hd-provider-codex').textContent.includes('No activity in this period')`)
    if (await js(`document.querySelectorAll('.hd-week-bars').length !== 1`)) throw new Error('Inactive provider rendered an empty chart')
    response = async () => fixtureData([history, row(today, 'claude', 30), row(today, 'codex', 15)])
    await reload()
    await until(`document.querySelector('.hd-usage-total').textContent.includes('45m') && document.querySelector('.hd-provider-claude').textContent.includes('30m') && document.querySelector('.hd-provider-codex').textContent.includes('15m')`)
    await clickText('.hd-tabs[aria-label="Usage period"] button', 'All Time')
    await until(`document.querySelector('.hd-usage-total').textContent.includes('2h 45m') && document.querySelector('.hd-provider-claude').textContent.includes('2h 30m')`)
    await clickText('.hd-tabs[aria-label="Usage period"] button', 'This Month')
    await until(`document.querySelector('.hd-usage .hd-period').textContent.includes('This month')`)
    await clickText('.hd-tabs[aria-label="Usage period"] button', 'This Week')
    response = async () => fixtureData([row(today, 'codex', 0, 1)])
    await reload()
    await until(`document.querySelector('.hd-provider-codex').textContent.includes('0m') && document.querySelector('.hd-provider-codex').textContent.includes('no measurable duration') && !document.querySelector('.hd-week-bars')`)
    let release: ((value: DashboardActivity) => void) | undefined
    response = () => new Promise(resolve => { release = resolve })
    await reload()
    await until(`document.querySelector('.hd-usage-total').textContent.includes('Loading') && !document.querySelector('.hd-week-bars')`)
    release?.(fixtureData([]))
    await until(`document.querySelector('.hd-usage-total').textContent.includes('No activity in this period')`)
    response = async () => { throw new Error('Home activity fixture unavailable') }
    await reload()
    await until(`document.querySelector('.hd-usage-total').textContent.includes('unavailable') && !!document.querySelector('.hd-data-error button')`)
    response = async () => fixtureData([history, row(today, 'claude', 30), row(today, 'codex', 15)])
    await clickText('.hd-data-error button', 'Retry')
    await until(`document.querySelector('.hd-usage-total').textContent.includes('45m') && !document.querySelector('.hd-data-error')`)
    const launchStyle = await js(`[...document.querySelectorAll('.hd-launch')].map(el => { const s = getComputedStyle(el); return { border: s.borderWidth, outline: s.outlineStyle, transform: s.transform, arrow: !!el.querySelector('.hd-launch-arrow') } })`)
    if (launchStyle.some((style: unknown) => JSON.stringify(style) !== JSON.stringify(launchStyle[0]))) throw new Error('Launch cards have unequal resting treatment')
    log('Home deterministic activity states, period totals and idle card: PASS')

    const common = { projectPath: scratch, projectName: 'Dashboard workspace', mode: 'headless' as const, permission: 'plan' as const, useWorktree: false, prompt: 'Local display fixture. Never launch an agent.' }
    const todo = createTask({ ...common, title: 'Review the dashboard wiring', dueAt: Date.now() + 86_400_000 })
    const completed = createTask({ ...common, title: 'Verify keyboard navigation' })
    const running = createTask({ ...common, title: 'Connect frontend and backend' })
    taskIds.push(todo.id, completed.id, running.id)
    setTaskRun(completed.id, { startedAt: Date.now() - 300_000, finishedAt: Date.now() - 60_000, result: 'Keyboard and navigation checks passed.' }, 'done')
    setTaskRun(running.id, { startedAt: Date.now() - 120_000, activity: 'Coordinating dashboard changes' }, 'running')
    running.team = { phase: 'running', plannerId: 'home-display-only', memberIds: [], plan: { size: 'small', summary: 'A display-only team fixture; no processes are launched.', agents: [{ id: 'dashboard', title: 'Dashboard wiring', prompt: 'Display fixture only.', files: ['src/'], dependsOn: [] }] } }
    for (const title of ['Check activity and provider totals', 'Polish the compact Home layout', 'Verify the complete task and review flow']) taskIds.push(createTask({ ...common, title, dueAt: Date.now() + 2 * 86_400_000 }).id)
    await until(`window.__mcSmoke.tasks().some(t => t.id === ${JSON.stringify(running.id)})`)

    await until(`!document.querySelector('.hd-idle') && document.querySelectorAll('.hd-stats .hd-stat').length === 5`)

    // Genuine keyboard input, rather than synthetic DOM keyboard events.
    await js(`document.querySelector('.hd-launch').focus()`)
    await key('Tab')
    await until(`document.activeElement === document.querySelectorAll('.hd-launch')[1]`)
    for (const period of ['This Month', 'All Time', 'This Week']) {
      await js(`[...document.querySelectorAll('.hd-tabs[aria-label="Usage period"] button')].find(b => b.textContent === ${JSON.stringify(period)}).focus()`)
      await key('Enter')
      await until(`document.querySelector('.hd-tabs[aria-label="Usage period"] [aria-pressed="true"]').textContent === ${JSON.stringify(period)}`)
    }
    let smallerHeatmap = 0
    for (const range of [30, 180]) {
      await js(`(() => { const select = document.querySelector('[aria-label="Activity date range"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${range}'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
      await until(`!!document.querySelector('.hd-activity [aria-label="${range}-day chat activity"]')`)
      const cells: number = await js(`document.querySelectorAll('.hd-activity .hd-heat-grid > i:not(.is-future)').length`)
      if (cells !== range) throw new Error(`Activity range ${range} rendered ${cells} in-range cells`)
      if (range === 30) smallerHeatmap = cells
      else if (cells <= smallerHeatmap) throw new Error('Activity range did not expand')
    }
    for (const filter of ['Agent Teams', 'All', 'Open Tasks']) {
      await clickText('.hd-tabs[aria-label="Task filter"] button', filter)
      await until(`document.querySelector('.hd-tabs[aria-label="Task filter"] [aria-pressed="true"]').textContent === ${JSON.stringify(filter)}`)
      if (filter === 'Agent Teams') await until(`!![...document.querySelectorAll('.hd-task-title')].find(b => b.textContent === ${JSON.stringify(running.title)})`)
    }
    const runningCheck = `[...document.querySelectorAll('.hd-task-check')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(`Mark ${running.title} done`)})`
    await until(`${runningCheck}?.disabled === true`)

    for (const theme of ['dark', 'light']) {
      await js(`if (document.documentElement.dataset.theme !== '${theme}') window.__mcSmoke.runShortcut('toggleTheme')`)
      await until(`document.documentElement.dataset.theme === '${theme}'`)
      for (const [width, height] of [[1440, 900], [960, 720]]) {
        win.setSize(width, height); await pause(350)
        await home()
        await js(`document.querySelector('.home.hd').scrollTop = 0; document.activeElement?.blur()`)
        const overflow = await js(`(() => [...document.querySelectorAll('.view-pane:not(.hidden), .home.hd, .hd-grid > .hd-panel')].map(el => ({ label: el.className, excess: el.scrollWidth - el.clientWidth })).filter(item => item.excess > 1))()`)
        if (overflow.length) throw new Error(`Home overflow at ${theme}/${width}: ${JSON.stringify(overflow)}`)
        await shot(`home-${theme}-${width}`)
        await js(`document.querySelector('.home.hd').scrollTop = document.querySelector('.home.hd').scrollHeight`)
        await shot(`home-${theme}-${width}-lower`)
      }
    }
    await home(); win.setSize(1440, 900)
    await js(`document.querySelector('.home.hd').scrollTop = 0`)
    await js(`[...document.querySelectorAll('.hd-task-check')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(`Mark ${todo.title} done`)}).click()`)
    await until(`window.__mcSmoke.tasks().find(t => t.id === ${JSON.stringify(todo.id)})?.column === 'done'`)
    await clickText('.hd-tabs[aria-label="Task filter"] button', 'All')
    await until(`!!document.querySelector(${JSON.stringify(`[aria-label="${todo.title} is done"]`)})?.disabled`)
    await clickText('.hd-tabs[aria-label="Task filter"] button', 'Open Tasks')
    for (const [label, selector] of [['New Project', '.new-project'], ['New Task', '.composer'], ['Use Template', '.templates']]) {
      await clickText('.hd-launch strong', label)
      // strong.click() bubbles through the actual launch button.
      await until(`!!document.querySelector(${JSON.stringify(selector)})`)
      await js(`document.querySelector('.overlay .dialog button[aria-label="Close"]').click()`)
      await until(`!document.querySelector('.overlay .dialog')`)
    }
    await clickText('.hd-quick-grid button', 'Settings')
    await until(`!!document.querySelector('.settings-pane')`)
    await js(`document.querySelector('.settings .dialog-head button[aria-label="Close"]').click()`)
    await until(`!document.querySelector('.settings-pane')`)

    for (const [label, selector] of [['Open Projects', '.projects-page'], ['View Chats', '.search-view'], ['Manage Agents', '.agents, .empty-state']]) {
      await home(); await clickText('.hd-quick-grid button', label)
      await until(`!document.querySelector('.view-pane:not(.hidden) .home.hd') && !!document.querySelector('.view-pane:not(.hidden)')?.querySelector(${JSON.stringify(selector)})`)
    }
    await home(); await clickText('.hd-quick-grid button', 'Workspace Files')
    await until(`!![...document.querySelectorAll('.view-pane:not(.hidden) .page-tabs button.active')].find(b => b.textContent.trim() === 'Docs')`)
    await home(); await clickText('.hd-quick-grid button', 'Run Script')
    await until(`!!document.querySelector('.bottom-dock.is-open .bottom-dock-tabs [aria-selected="true"]') && document.querySelector('.bottom-dock.is-open .bottom-dock-tabs [aria-selected="true"]').textContent.trim() === 'Run'`)
    await js(`document.querySelector('[aria-label="Collapse project tools"]').click()`)

    // Launch only inside our own scratch project, with the preferred provider deliberately opposite.
    for (const tool of ['claude', 'codex'] as const) {
      updateStore(s => { s.projectMeta[normalizePath(scratch)].preferredAgent = tool === 'claude' ? 'codex' : 'claude' })
      await js(`window.__mcSmoke.refresh(); window.__mcSmoke.selectProject(${JSON.stringify(scratch)})`)
      await home()
      await until(`document.querySelector('.hd-launch.hd-tone-${tool}').title.includes('Dashboard workspace')`)
      const before = await js(`window.__mcSmoke.agents().map(a => a.id)`)
      await js(`document.querySelector('.hd-launch.hd-tone-${tool}').click()`)
      await until(`window.__mcSmoke.agents().some(a => !${JSON.stringify(before)}.includes(a.id))`)
      const agent = await js(`window.__mcSmoke.agents().find(a => !${JSON.stringify(before)}.includes(a.id))`)
      ownedAgents.push(agent.id)
      if (agent.kind !== tool || normalizePath(agent.cwd) !== normalizePath(scratch)) throw new Error(`Home ${tool} card launched wrong provider or folder: ${JSON.stringify(agent)}`)
      for (let i = 0; i < 150 && !output.get(agent.id)?.includes(`MC_HOME_FIXTURE_${tool.toUpperCase()}`); i++) await pause()
      if (!output.get(agent.id)?.includes(`MC_HOME_FIXTURE_${tool.toUpperCase()}`)) throw new Error(`Home ${tool} did not execute its local fixture: ${output.get(agent.id) ?? ''}`)
      await js(`window.__mcSmoke.closeAgent(${JSON.stringify(agent.id)})`)
      await until(`!window.__mcSmoke.agents().some(a => a.id === ${JSON.stringify(agent.id)})`)
      log('home provider routing passed', tool)
    }
    await home()
    log('Home dashboard: panels, metrics, responsive themes, keyboard, filters, navigation and fixture providers: PASS')
  } catch (error) {
    try { await shot('home-failure') } catch { /* Keep the original failure. */ }
    throw error
  } finally {
    for (const id of ownedAgents) { try { await js(`window.__mcSmoke.closeAgent(${JSON.stringify(id)})`) } catch { /* Window may be closing. */ } }
    ipcMain.removeHandler('index:dashboard')
    ipcMain.handle('index:dashboard', () => queryIndex('dashboardActivity'))
    ptyTaps.delete(tap)
    for (const id of taskIds) if (listTasks().some(task => task.id === id)) deleteTask(id)
    flushTasks()
    process.env.PATH = originalPath
    try {
      await js(`if (document.documentElement.dataset.theme !== ${JSON.stringify(saved.settings.theme)}) window.__mcSmoke.runShortcut('toggleTheme'); window.mc.setZoom(${saved.settings.uiZoom || 1}); window.__mcSmoke.selectProject(${JSON.stringify(saved.ui.selectedPath ?? null)}); window.__mcSmoke.setView('home')`)
      await pause(200)
    } catch { /* Preserve settings even if the window has closed. */ }
    updateStore(s => { s.settings = saved.settings; s.projectMeta = saved.projectMeta; s.manualProjects = saved.manualProjects; s.savedAgents = saved.savedAgents; s.ui = saved.ui })
  }
}
