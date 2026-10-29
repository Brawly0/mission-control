import type { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { listProjects, normalizePath } from './claudeData'
import { loadStore, updateStore } from './store'
import { setRateLimit } from './tasks'

/** Free UI regression test: uses only local CLI status checks and PowerShell. */
export async function workspaceUiSmoke(win: BrowserWindow, outFile: string, log: (...values: unknown[]) => void) {
  // Errors name the script that failed; Electron's own message doesn't.
  const js = (code: string) => win.webContents.executeJavaScript(code).catch((e) => { throw new Error(`${e.message}
  in: ${code.slice(0, 160)}`) })
  const pause = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (code: string) => {
    for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(100) }
    throw new Error(`UI condition timed out: ${code}`)
  }
  const shot = async (name: string) => {
    win.show(); win.focus()
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await win.webContents.capturePage()
    await pause()
    writeFileSync(outFile.replace(/\.png$/, `-${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  const before = structuredClone(loadStore().projectMeta)
  const themeBefore = loadStore().settings.theme
  win.show()
  win.webContents.setBackgroundThrottling(false)
  await until('!!window.__mcSmoke')
  try {
    // The shell scenario uses deterministic IPC fixtures only, including delayed refreshes.
    const reload = async () => {
      win.webContents.reload()
      await pause(400)
      await until('!!window.__mcSmoke && !!document.querySelector(".provider-chip")')
    }
    const retry = async () => {
      await js(`document.querySelector('.provider-chip').open = true; document.querySelector('.provider-details button:last-child').click()`)
      await until(`!document.querySelector('.provider-details button:last-child').disabled`)
    }
    win.setContentSize(1440, 900)
    await until(`document.querySelector('.provider-chip summary').textContent.includes('41%')`)
    if (!await js(`document.querySelectorAll('.provider-chip summary .plan-meter-track').length === 4 && ['claude','codex'].every(tool => document.querySelector('[data-provider="'+tool+'"]')?.textContent.includes('Week'))`)) throw new Error('Both providers must show their session and weekly bars directly in the header')
    await js(`window.__mcSmoke.setView('home')`)
    if (process.env.MC_SMOKE_CLEAN && await js(`!!document.querySelector('.hd-name')`)) throw new Error('Clean fixture exposed a greeting name')
    // Test unavailable -> retry -> success, including rejected renderer IPC.
    for (const scenario of ['missing', 'empty', 'timeout', 'reject']) {
      process.env.MC_SMOKE_PLAN_FIXTURE = scenario
      setRateLimit({ at: Date.now(), status: '', windows: [] })
      await retry()
      await until(`document.querySelector('.provider-chip summary').textContent.includes('Unavailable')`)
      if (await js(`document.querySelector('.provider-details').textContent.includes('Waiting for the first reading')`)) throw new Error('Settled failure remained loading')
      process.env.MC_SMOKE_PLAN_FIXTURE = ''
      process.env.MC_SMOKE_PROVIDER_DELAY = '500'
      await js(`document.querySelector('.provider-details button:last-child').click()`)
      await until(`document.querySelector('.provider-chip summary').textContent.includes('Retrying')`)
      await until(`document.querySelector('.provider-chip summary').textContent.includes('41%') && !document.querySelector('.provider-details button:last-child').disabled`)
      process.env.MC_SMOKE_PROVIDER_DELAY = ''
    }
    process.env.MC_SMOKE_PLAN_FIXTURE = 'failure'
    await retry()
    await until(`document.querySelector('.provider-chip summary').textContent.includes('41%') && document.querySelector('.provider-details').textContent.includes('last good reading')`)
    await js(`window.__mcSmoke.setView('usage')`)
    await until(`document.querySelector('.plan-error')?.textContent.includes('unavailable')`)
    process.env.MC_SMOKE_PLAN_FIXTURE = ''
    await retry()
    // A restart immediately shows the validated cached status while checks are delayed.
    process.env.MC_SMOKE_PROVIDER_DELAY = '2500'
    const cached = { at: Date.now() - 600_000, status: { installed: true, loggedIn: true, email: 'must-not-survive@example.invalid' } }
    await js(`localStorage.setItem('mc.connectionStatus.v1', ${JSON.stringify(JSON.stringify({ claude: cached, codex: cached }))})`)
    await reload()
    await until(`document.querySelector('.connection-toggle').getAttribute('aria-label').includes('Connected')`)
    await js(`document.querySelector('.connection-toggle').click()`)
    if (!await js(`document.querySelector('.connection-details').textContent.includes('Refreshing quietly')`)) throw new Error('Cached status did not render before refresh')
    await until(`!document.querySelector('.connection-details').textContent.includes('Refreshing quietly')`)
    if (await js(`localStorage.getItem('mc.connectionStatus.v1').includes('email')`)) throw new Error('Connection cache retained sensitive fields')
    process.env.MC_SMOKE_CONNECTION_FIXTURE = 'failure'
    process.env.MC_SMOKE_PROVIDER_DELAY = ''
    await js(`document.querySelector('[aria-label="Refresh agent connections"]').click()`)
    await until(`document.querySelector('.connection-toggle').getAttribute('aria-label').includes('check failed')`)
    if (!await js(`document.querySelector('.connection-toggle').getAttribute('aria-label').includes('Claude Connected')`)) throw new Error('Failure discarded prior status')
    process.env.MC_SMOKE_CONNECTION_FIXTURE = ''
    // Malformed cache is an unknown state, never a disconnected assertion.
    process.env.MC_SMOKE_PROVIDER_DELAY = '2500'
    await js(`localStorage.setItem('mc.connectionStatus.v1', '{broken')`)
    await reload()
    if (!await js(`document.querySelector('.connection-toggle').getAttribute('aria-label').includes('Unknown')`)) throw new Error('Malformed cache was trusted')
    await until(`document.querySelector('.connection-toggle').getAttribute('aria-label').includes('Connected')`)
    process.env.MC_SMOKE_PROVIDER_DELAY = ''
    const savedSidebar = loadStore().ui.sidebarCollapsed
    for (const theme of ['dark', 'light']) {
      await js(`if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) window.__mcSmoke.runShortcut('toggleTheme')`)
      await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`)
      for (const width of [1440, 960, 1440]) {
        win.setContentSize(width, 900)
        await pause(400)
        const geometry = await js(`(() => { const bar=document.querySelector('.topbar'), r=bar.getBoundingClientRect(); return {height:r.height, overflow:bar.scrollWidth>bar.clientWidth+1, outside:[...bar.children].some(c=>{ const b=c.getBoundingClientRect(); return b.top<r.top || b.bottom>r.bottom+1 }), rail:!!document.querySelector('.sidebar.rail')}; })()`)
        if (geometry.height > 61 || geometry.overflow || geometry.outside || (width === 960 && !geometry.rail)) throw new Error('Compact shell geometry: ' + JSON.stringify(geometry))
        await js(`document.querySelector('.provider-chip').open=false; document.querySelector('.provider-chip summary').focus()`)
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
        await until(`document.querySelector('.provider-chip').open`)
        await js(`document.querySelector('.provider-details button:last-child').focus()`)
        if (!await js(`document.activeElement.textContent.includes('Retry Claude')`)) throw new Error('Retry is not focusable')
        await shot(`shell-${theme}-${width}`)
        await js(`document.querySelector('.provider-chip').open=false`)
      }
    }
    if (loadStore().ui.sidebarCollapsed !== savedSidebar) throw new Error('Responsive rail overwrote saved preference')
    log('shell: provider failures/retry/stale, cached restart/malformed/partial failure, keyboard details and responsive themes PASS')
    if (process.env.MC_SMOKE_SHELL) return
    win.setContentSize(1440, 900)
    const project = (await listProjects()).find(p => p.folderName === 'claude-hub')!
    if (!project) throw new Error('Missing test project')
    const path = JSON.stringify(project.path)
    await js(`window.__mcSmoke.selectProject(${path}); window.__mcSmoke.setView('projects')`)
    await until(`!!document.querySelector('.big-project[data-project-path]')`)
    // Expand the logo status indicator and verify both providers have completed a check.
    await js(`document.querySelector('.connection-toggle').click()`)
    await until(`document.querySelectorAll('.connection-row').length === 2 && ![...document.querySelectorAll('.connection-row')].some(e => e.textContent.includes('Checking'))`)
    log('connections:', await js(`document.querySelector('.agent-connections').textContent`))
    await shot('connections')
    // Right-click the project and rename it through the existing identity editor.
    await js(`document.querySelectorAll('.big-project').forEach(e => { if(e.dataset.projectPath === ${path}) e.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:500,clientY:200})) })`)
    await until(`!!document.querySelector('.project-context-menu')`)
    await shot('project-menu')
    await js(`[...document.querySelectorAll('.project-context-menu button')].find(b => b.textContent === 'Rename project').click()`)
    await until(`!!document.querySelector('.identity-preview')`)
    await js(`(() => { const input = document.querySelector('.identity-preview').closest('.dialog').querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'UI smoke renamed'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    await pause()
    await js(`[...document.querySelectorAll('.dialog-foot button')].find(b => b.textContent === 'Save').click()`)
    await until(`!![...document.querySelectorAll('.big-project-name')].find(e => e.textContent.includes('UI smoke renamed'))`)
    if (loadStore().projectMeta[normalizePath(project.path)].displayName !== 'UI smoke renamed') throw new Error('Rename not persisted')
    log('rename: persisted; folder unchanged')
    // Real drag events exercise React's handlers, preserving every hidden project.
    const moved: { source: string; target: string } = await js(`(() => {
      const cards = [...document.querySelectorAll('.big-project')]; const source = cards[cards.length-1], target = cards[0];
      const transfer = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', {bubbles:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent('dragover', {bubbles:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent('drop', {bubbles:true,dataTransfer:transfer,clientY:target.getBoundingClientRect().top}));
      return {source:source.dataset.projectPath,target:target.dataset.projectPath};
    })()`)
    await until(`document.querySelector('.big-project')?.dataset.projectPath === ${JSON.stringify(moved.source)}`)
    const meta = loadStore().projectMeta
    if (!(meta[normalizePath(moved.source)].sortOrder! < meta[normalizePath(moved.target)].sortOrder!)) throw new Error('Order not persisted')
    log('drag reorder: persisted')
    await js(`window.__mcSmoke.setView('home')`); await pause()
    await js(`window.__mcSmoke.setView('projects')`); await pause()
    await until(`document.querySelector('.big-project')?.dataset.projectPath === ${JSON.stringify(moved.source)}`)
    await shot('projects')
    // The sidebar exposes the same rename action and drag handlers.
    await js(`document.querySelectorAll('.project-list [data-project-path]').forEach(e => { if(e.dataset.projectPath === ${path}) e.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:180,clientY:400})) })`)
    await until(`!!document.querySelector('.project-context-menu')`)
    await js(`[...document.querySelectorAll('.project-context-menu button')].find(b => b.textContent === 'Rename project').click()`)
    await until(`!!document.querySelector('.identity-preview')`)
    await shot('sidebar-rename')
    await js(`[...document.querySelectorAll('.dialog-foot button')].find(b => b.textContent === 'Cancel').click()`)
    const sidebarMoved: string = await js(`(() => {
      const group = [...document.querySelectorAll('.project-list .group ul')].find(e => e.children.length > 1);
      const source = group.lastElementChild, target = group.firstElementChild, transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', {bubbles:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent('drop', {bubbles:true,dataTransfer:transfer,clientY:target.getBoundingClientRect().top}));
      return source.dataset.projectPath;
    })()`)
    await until(`[...document.querySelectorAll('.project-list .group ul')].some(e => e.firstElementChild?.dataset.projectPath === ${JSON.stringify(sidebarMoved)})`)
    log('sidebar: right-click rename and drag passed')
    // The Agents toolbar must use the active terminal's cwd, not the selected project.
    await js(`window.__mcSmoke.launch({cwd:${JSON.stringify(process.env.TEMP || project.path)},projectPath:${path},projectName:'UI smoke',title:'Folder context test',kind:'shell'})`)
    await until(`!!document.querySelector('.agent-bar-end button[title^="Open PowerShell"]')`)
    const count = await js(`window.__mcSmoke.agents().length`)
    await js(`document.querySelector('.agent-bar-end button[title^="Open PowerShell"]').click()`)
    await until(`!!document.querySelector('.dock-terminal-pane .xterm')`)
    const id = await js(`document.querySelector('.dock-terminal-pane').dataset.terminalId`)
    if (await js('window.__mcSmoke.agents().length') !== count) throw new Error('Dock shell added as agent')
    if (await js(`document.querySelector('.dock-folder').title`) !== (process.env.TEMP || project.path)) throw new Error('Wrong terminal folder')
    await js(`window.__dockOutput = ''; window.__dockOff = window.mc.onPtyData((id,data) => { if (id === ${JSON.stringify(id)}) window.__dockOutput += data }); window.mc.ptyWrite(${JSON.stringify(id)}, "Write-Output ('MC_DOCK_' + 'READY'); $PWD.Path\\r")`)
    await until(`window.__dockOutput.includes('MC_DOCK_READY')`)
    await shot('dock-dark')
    await js(`document.querySelector('[aria-label="Collapse project tools"]').click(); window.mc.ptyWrite(${JSON.stringify(id)}, "Write-Output ('MC_COLLAPSED_' + 'ALIVE')\\r")`)
    await until(`window.__dockOutput.includes('MC_COLLAPSED_ALIVE')`)
    await js(`document.querySelector('[aria-label="Expand project tools"]').click()`)
    await until(`document.querySelector('.bottom-dock.is-open') && document.querySelector('.dock-terminal-pane').dataset.terminalId === ${JSON.stringify(id)}`)
    await js(`document.querySelector('.dock-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`)
    await pause()
    const height = await js(`document.querySelector('.bottom-dock').getBoundingClientRect().height`)
    await js(`document.querySelector('.dock-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))`)
    await until(`document.querySelector('.bottom-dock').getBoundingClientRect().height > ${height}`)
    await js(`if (document.documentElement.dataset.theme !== 'light') window.__mcSmoke.runShortcut('toggleTheme')`)
    await until(`document.documentElement.dataset.theme === 'light'`)
    await shot('dock-light')
    win.setSize(1000, 760); await pause(400)
    await shot('dock-narrow')
    if (await js(`document.querySelector('.agent-bar').scrollWidth > document.querySelector('.agent-bar').clientWidth + 1`)) throw new Error('Agent toolbar overflow')
    if (await js(`document.querySelector('.agent-stage').getBoundingClientRect().height < 140`)) throw new Error('Dock leaves too little space for agents')
    await js(`window.__mcSmoke.setView('home'); window.mc.ptyWrite(${JSON.stringify(id)}, "Write-Output ('MC_HIDDEN_' + 'ALIVE')\\r")`)
    await until(`window.__dockOutput.includes('MC_HIDDEN_ALIVE')`)
    await js(`window.__mcSmoke.setView('agents'); window.__dockOff(); void 0`)
    // Panes stay mounted while hidden; wait until the dock has reselected this folder's terminal.
    await until(`!!document.querySelector('[aria-label="Close dock terminal and stop its process"]')`)
    await js(`document.querySelector('[aria-label="Close dock terminal and stop its process"]').click()`)
    await until(`!document.querySelector('.dock-terminal-pane')`)
    log('dock: correct folder, independent shell, alive while collapsed/hidden, stable pane, resize, close, dark/light and narrow layout passed')
    await js(`window.__mcSmoke.launch({cwd:${path},projectPath:${path},projectName:'UI smoke',title:'Second tab',kind:'shell'})`)
    await until(`document.querySelectorAll('.agent-tab').length === 2`)
    await js(`window.__mcSmoke.launch({cwd:${JSON.stringify(process.env.TEMP || project.path)},projectPath:${JSON.stringify(process.env.TEMP || project.path)},projectName:'UI smoke',title:'Other project',kind:'shell'})`)
    await until(`document.querySelectorAll('.agent-tab-group').length === 2`)
    await js(`document.querySelector('.agent-navigation button[title="Switch to any open agent"]').click()`)
    await until(`document.querySelectorAll('.menu[role="menu"] .menu-item').length === 3`)
    await shot('agent-switcher')
    const first = await js(`window.__mcSmoke.agents()[0].id`)
    await js(`document.querySelector('.menu[role="menu"] .menu-item').click()`)
    await until(`document.querySelector('[data-agent-id=${JSON.stringify(first)}]')?.getAttribute('aria-pressed') === 'true'`)
    log('agent navigation: grouped across two projects; overflow switcher selects original tab')
    await js(`window.__mcSmoke.agents().filter(a => a.projectName === 'UI smoke').forEach(a => window.__mcSmoke.closeAgent(a.id))`)
    log('workspace UI: PASS')
  } finally {
    delete process.env.MC_SMOKE_PLAN_FIXTURE
    delete process.env.MC_SMOKE_CONNECTION_FIXTURE
    delete process.env.MC_SMOKE_PROVIDER_DELAY
    await js(`window.mc.setSettings({theme:${JSON.stringify(themeBefore)}})`)
    updateStore(s => { s.projectMeta = before })
  }
}
