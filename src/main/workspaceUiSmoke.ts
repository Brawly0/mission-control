import type { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { listProjects, normalizePath } from './claudeData'
import { loadStore, updateStore } from './store'

/** Free UI regression test: uses only local CLI status checks and PowerShell. */
export async function workspaceUiSmoke(win: BrowserWindow, outFile: string, log: (...values: unknown[]) => void) {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const pause = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (code: string) => {
    for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(100) }
    throw new Error(`UI condition timed out: ${code}`)
  }
  const shot = async (name: string) => {
    await pause()
    writeFileSync(outFile.replace(/\.png$/, `-${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  const before = structuredClone(loadStore().projectMeta)
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
    await until(`window.__mcSmoke.agents().length === ${count + 1}`)
    const agent = await js(`window.__mcSmoke.agents().at(-1)`)
    if (agent.kind !== 'shell' || agent.cwd !== (process.env.TEMP || project.path)) throw new Error('Wrong terminal kind or cwd')
    await js(`window.mc.ptyWrite(${JSON.stringify(agent.id)}, "Write-Output 'MC_TERMINAL_READY'\\r")`)
    await pause(2500)
    await shot('terminal')
    log('terminal: PowerShell launched in active folder')
    await js(`window.__mcSmoke.agents().filter(a => a.projectName === 'UI smoke').forEach(a => window.__mcSmoke.closeAgent(a.id))`)
    log('workspace UI: PASS')
  } finally {
    updateStore(s => { s.projectMeta = before })
  }
}
