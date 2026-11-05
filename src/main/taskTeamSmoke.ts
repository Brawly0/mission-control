import { app, type BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TeamPlan } from '../shared/types'
import { createTask, listTasks } from './tasks'
import { loadStore, updateStore } from './store'
import { normalizePath } from './claudeData'

/** Native UI + IPC + real child processes + git; the CLI is a local fixture, never a model. */
export async function taskTeamSmoke(win: BrowserWindow, outFile: string, log: (...v: unknown[]) => void) {
  const before = structuredClone(loadStore())
  const oldPath = process.env.PATH
  const repo = join(app.getPath('userData'), 'team-fixture')
  const bin = join(app.getPath('userData'), 'fixture-bin')
  mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true })
  const node = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, encoding: 'utf8' })
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Team test']); git(['config', 'user.email', 'team-test@example.invalid'])
  writeFileSync(join(repo, 'README.md'), '# Team test\n')
  git(['add', 'README.md']); git(['commit', '-m', 'Initial fixture'])
  const plan: TeamPlan = { size: 'medium', summary: 'Two independent file owners, followed by integration and project checks.', agents: [
    { id: 'backend', title: 'Backend contract', prompt: 'FIXTURE_BACKEND: implement backend.txt and verify the contract.', files: ['backend.txt'], dependsOn: [] },
    { id: 'frontend', title: 'Frontend flow', prompt: 'FIXTURE_FRONTEND: implement frontend.txt and verify the flow.', files: ['frontend.txt'], dependsOn: [] }
  ] }
  const fixture = join(bin, 'agent.cjs')
  writeFileSync(fixture, `const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('fixture 1.0.0'); process.exit(0); }
if (process.stdin.isTTY) {
  // Interactive task: a tiny TUI that echoes each key once, so doubled input would show.
  console.log('INTERACTIVE_FIXTURE ready');
  process.stdin.setRawMode(true); process.stdin.setEncoding('utf8');
  process.stdin.on('data', s => { if (s === 'q') process.exit(0); process.stdout.write('[key:' + s + ']'); });
  return;
}
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => input += s);
process.stdin.on('end', () => {
  let result, delay = 50;
  if (input.includes('Plan an agent team')) result = JSON.stringify(${JSON.stringify(plan)});
  else if (input.includes('You are the final integration agent.')) {
    if (!fs.existsSync('backend.txt') || !fs.existsSync('frontend.txt')) process.exit(2);
    result = 'Both workers are integrated and verified.';
  } else if (input.includes('Your assignment:\\nFIXTURE_BACKEND') || input.includes('Your assignment:\\nFIXTURE_FRONTEND')) {
    if (!process.cwd().toLowerCase().startsWith(${JSON.stringify(join(repo, '.claude', 'worktrees').toLowerCase())} + require('node:path').sep)) process.exit(3);
    const file = input.includes('Your assignment:\\nFIXTURE_BACKEND') ? 'backend.txt' : 'frontend.txt';
    fs.writeFileSync(file, 'Implemented by the scoped fixture worker.\\n'); result = 'Completed ' + file; delay = 10000;
  } else result = 'Fixture idle';
  console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Working on the assigned scope'}]}}));
  setTimeout(() => console.log(JSON.stringify({type:'result',subtype:'success',result,total_cost_usd:0.01,num_turns:1})), delay);
});`)
  writeFileSync(join(bin, 'claude.cmd'), `@echo off\r\n"${node}" "${fixture}" %*\r\n`)
  process.env.PATH = `${bin};${oldPath ?? ''}`
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (test: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 150; i++) { if (await test()) return; await pause() }
    throw new Error('Agent team smoke condition timed out')
  }
  const click = (selector: string, label: string) => js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) throw new Error('Missing enabled button: ' + ${JSON.stringify(label)}); b.click(); })()`)
  const shot = async (suffix: string) => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await pause(150)
    writeFileSync(outFile.replace(/\.png$/, `-${suffix}.png`), (await win.webContents.capturePage()).toPNG())
  }
  try {
    updateStore(s => {
      s.manualProjects.push(repo)
      s.settings.queueEnabled = false; s.settings.queuePauseAtPercent = 0
      s.projectMeta[normalizePath(repo)] = { tags: [], notes: '', checkCommand: `& '${node.replace(/'/g, "''")}' -e "if (!require('fs').existsSync('backend.txt') || !require('fs').existsSync('frontend.txt')) process.exit(1)"` }
    })
    win.show(); win.focus(); win.webContents.setBackgroundThrottling(false)
    await until(() => js('!!window.__mcSmoke'))
    await js('window.__mcSmoke.refresh()')
    await js(`window.__mcSmoke.setView('tasks')`)
    const root = createTask({ title: 'Build a coordinated feature', prompt: 'Implement the backend contract and frontend flow, integrate both, and run checks.', tool: 'claude', projectPath: repo, projectName: 'Team test', mode: 'headless', permission: 'auto', useWorktree: false, budgetUsd: 2 })
    await until(() => js(`window.__mcSmoke.tasks().some(t => t.id === ${JSON.stringify(root.id)})`))
    await js(`window.__mcSmoke.openTask(${JSON.stringify(root.id)})`)
    await until(() => js(`!!document.querySelector('.drawer-actions')`))
    await js(`(() => { const select = document.querySelector('[aria-label="Agent team execution"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'headless'); select.dispatchEvent(new Event('change', {bubbles:true})); })()`)
    await click('.drawer-actions button', 'Split into agents')
    await until(() => root.team?.phase === 'ready')
    if (root.team?.plan?.agents.length !== 2) throw new Error('Team plan did not cross the real IPC/stream boundary')
    for (const theme of ['dark', 'light']) {
      await js(`if (document.documentElement.dataset.theme !== '${theme}') window.__mcSmoke.runShortcut('toggleTheme')`)
      for (const width of [1440, 960]) {
        win.setSize(width, width === 960 ? 680 : 900); await pause(200)
        await until(() => js(`document.querySelectorAll('.team-assignment').length === 2`))
        await js(`document.querySelector('.team-assignment').open = true`)
        const overflow = await js(`(() => { const el = document.querySelector('.drawer-body'); return el.scrollWidth - el.clientWidth })()`)
        if (overflow > 1) throw new Error(`Team drawer overflows at ${width} in ${theme}`)
        await shot(`plan-${theme}-${width}`)
      }
    }
    await click('.team-panel-actions button', 'Start 2 agents')
    await until(() => listTasks().filter(t => t.teamParentId === root.id && t.teamRole === 'worker' && t.column === 'running').length === 2)
    await shot('running')
    // Starting a team opens its task-owned agent workspace, never the Agents page.
    const termText = `[...document.querySelectorAll('.task-term')].map(t => t.querySelector('.xterm-rows')?.textContent ?? '')`
    await until(() => js(`!!document.querySelector('.task-agent-workspace') && !document.querySelector('.drawer')`))
    await js(`document.querySelector('.task-workspace-toolbar button[aria-label="Task and team controls"]').click()`)
    await click('.team-panel button', 'Watch agents')
    await until(() => js(`document.querySelectorAll('.task-agent-tab').length === 4 && !document.querySelector('.drawer')`))
    await click('.task-agent-layout button', 'Tabs')
    await until(() => js(`document.querySelectorAll('.task-agent-stage.tabs .task-term:not(.stacked-hidden)').length === 1`))
    const pending = listTasks().find(t => t.teamParentId === root.id && t.teamRole === 'integrator')!
    await js(`document.querySelector('[data-member-id="${pending.id}"]').click()`)
    await until(() => js(`document.querySelector('.task-term:not(.stacked-hidden) .task-agent-waiting')?.textContent.includes('Runs after:')`))
    await shot('agents-waiting-tab')
    // Keyboard tab navigation selects the planner, without leaving Tasks.
    await js(`document.querySelector('.task-agent-tab[aria-selected="true"]').focus()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' })
    await until(() => js(`document.querySelector('.task-agent-tab[aria-selected="true"]')?.textContent.includes('Planner')`))
    await click('.task-agent-layout button', 'Grid')
    await until(() => js(`${termText}.filter(t => t.includes('Working on the assigned scope') && t.includes('claude -p')).length >= 2`))
    await shot('terminals-running')
    await js(`window.__mcSmoke.openTask(${JSON.stringify(root.id)})`)
    await until(() => root.team?.phase === 'review')
    if (!root.worktree || !existsSync(join(root.worktree.path, 'backend.txt')) || !existsSync(join(root.worktree.path, 'frontend.txt'))) throw new Error('Combined worker files missing')
    if (existsSync(join(repo, 'backend.txt')) || existsSync(join(repo, 'frontend.txt'))) throw new Error('Workers edited the main checkout')
    if (root.run?.checks?.status !== 'passed' || !root.run.commit) throw new Error('Final checks/commit did not complete')
    await until(() => js(`document.querySelector('.team-phase')?.textContent.includes('Ready for your review')`))
    await shot('review')
    await js('window.__mcSmoke.openTask(null)')
    await click('.task-agent-layout button', 'Tabs')
    for (const member of listTasks().filter(t => t.teamParentId === root.id)) {
      await js(`document.querySelector('[data-member-id="${member.id}"]').click()`)
      await until(() => js(`(() => { const text = document.querySelector('.task-term:not(.stacked-hidden) .xterm-rows')?.textContent ?? ''; return text.includes('✓ Done') && text.includes('process exited with code 0'); })()`))
    }
    await shot('terminals-done')
    await click('.task-agent-layout button', 'Grid')
    await js(`document.querySelector('.task-agent-stage button[aria-label="Maximize"]').click()`)
    await until(() => js(`document.querySelectorAll('.task-agent-stage.has-max .task-term:not(.stacked-hidden)').length === 1`))
    await js(`document.querySelector('.task-agent-stage button[aria-label="Restore"]').click()`)
    await until(() => js(`document.querySelectorAll('.task-agent-stage .task-term:not(.stacked-hidden)').length === 4`))
    for (const theme of ['dark', 'light']) {
      await js(`if (document.documentElement.dataset.theme !== '${theme}') window.__mcSmoke.runShortcut('toggleTheme')`)
      for (const width of [1440, 960]) {
        win.setSize(width, width === 960 ? 600 : 900)
        for (const mode of ['Tabs', 'Grid']) {
          await click('.task-agent-layout button', mode)
          await pause(150)
          const overflow = await js(`(() => { const el = document.querySelector('.task-agent-workspace'); return el.scrollWidth - el.clientWidth })()`)
          if (overflow > 1) throw new Error(`Task agents overflow at ${width} in ${theme}/${mode}`)
          await shot(`agents-${theme}-${width}-${mode.toLowerCase()}`)
        }
      }
    }
    // A finished historical planner remains selectable, and selecting a worker reveals its own output.
    await click('.task-agent-layout button', 'Tabs')
    const worker = listTasks().find(t => t.teamParentId === root.id && t.teamRole === 'worker')!
    await js(`document.querySelector('[data-member-id="${worker.id}"]').click()`)
    await until(() => js(`document.querySelector('.task-term:not(.stacked-hidden)')?.getAttribute('data-task-id') === '${worker.id}'`))
    await js(`[...document.querySelectorAll('.tasks-layout-switch button')].find(b => b.textContent.trim() === 'Board').click()`)
    await click('.task-card button', 'Watch agents')
    await until(() => js(`!!document.querySelector('.task-agent-workspace') && document.querySelector('.view-pane:not(.hidden) .tasks-view')`))
    // An interactive task: its real PTY stays in Tasks and takes input once.
    const live = createTask({ title: 'Interactive terminal check', prompt: 'Say hello.', tool: 'claude', projectPath: repo, projectName: 'Team test', mode: 'interactive', permission: 'auto', useWorktree: false })
    await until(() => js(`window.__mcSmoke.tasks().some(t => t.id === ${JSON.stringify(live.id)})`))
    await js(`window.__mcSmoke.startTask(window.__mcSmoke.tasks().find(t => t.id === ${JSON.stringify(live.id)}))`)
    const liveTerm = `document.querySelector('.task-term[data-task-id="${live.id}"]')`
    const liveText = `(${liveTerm}?.querySelector('.xterm-rows')?.textContent ?? '')`
    await until(() => js(`${liveText}.includes('INTERACTIVE_FIXTURE ready')`))
    if (!(await js(`!!document.querySelector('.view-pane:not(.hidden) .tasks-view')`))) throw new Error('Starting an interactive task left the Tasks page')
    await js(`${liveTerm}.querySelector('.xterm-helper-textarea').focus()`)
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' })
    await until(() => js(`${liveText}.includes('[key:x]')`))
    await pause(400)
    const echoes = await js(`${liveText}.split('[key:x]').length - 1`)
    if (echoes !== 1) throw new Error(`Interactive task input arrived ${echoes} times`)
    await shot('terminals-interactive')
    const agentId = listTasks().find(t => t.id === live.id)?.run?.agentId
    if (!agentId) throw new Error('Interactive task has no agent')
    await js(`window.__mcSmoke.closeAgent(${JSON.stringify(agentId)})`)
    await until(() => listTasks().find(t => t.id === live.id)?.column === 'review')
    await js(`window.__mcSmoke.openTask(${JSON.stringify(root.id)})`)
    await until(() => js(`!!document.querySelector('.team-members')`))
    await js(`document.querySelector('.team-members li:last-child button').click()`)
    await until(() => js(`!!document.querySelector('.team-parent-link')`))
    await js('document.querySelector(".team-parent-link").click()')
    await until(() => js(`document.querySelector('.drawer-title')?.textContent.includes('Build a coordinated feature')`))
    await js('window.__mcSmoke.openTask(null); window.__mcSmoke.openComposer()')
    await until(() => js(`!!document.querySelector('.team-compose-action')`))
    await shot('composer')
    const composerOverflow = await js(`(() => { const d = document.querySelector('.composer'); return d.scrollWidth - d.clientWidth })()`)
    if (composerOverflow > 1) throw new Error('Task composer overflows')
    log('agent team: PASS — real IPC and fixture planner/workers, task-owned Tabs/Grid, waiting/completed agents, keyboard navigation, maximize/restore, board/drawer entry, integration/checks/commit, interactive single input, dark/light at 1440/960x600')
  } finally {
    process.env.PATH = oldPath
    updateStore(s => Object.assign(s, before))
  }
}
