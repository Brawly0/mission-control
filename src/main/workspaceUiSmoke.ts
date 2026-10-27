import type { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { listProjects, normalizePath } from './claudeData'
import { loadStore, updateStore } from './store'

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
    const project = (await listProjects()).find(p => p.folderName === 'claude-hub')!
    if (!project) throw new Error('Missing test project')
    const path = JSON.stringify(project.path)
    await js(`window.__mcSmoke.selectProject(${path}); window.__mcSmoke.setView('projects')`)
    await until(`!!document.querySelector('.big-project[data-project-path]')`)
    // Expand real connection status and verify both providers have completed a check.
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
    await js(`window.mc.setSettings({theme:${JSON.stringify(themeBefore)}})`)
    updateStore(s => { s.projectMeta = before })
  }
}
