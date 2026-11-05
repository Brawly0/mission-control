import { app, type BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createTask, listTasks, runningTaskCount, stopTaskTeam } from './tasks'
import { loadStore, updateStore } from './store'
import { normalizePath } from './claudeData'

/** Full UI/IPC/PTY flow against local CLI fixtures. No model calls or user transcripts. */
export async function taskLiveCliSmoke(win: BrowserWindow, outFile: string, log: (...v: unknown[]) => void) {
  const own = app.getPath('userData')
  if (!process.env.CODEX_HOME || !resolve(process.env.CODEX_HOME).startsWith(resolve(own) + sep)) throw new Error('Live CLI smoke needs CODEX_HOME inside its isolated profile.')
  const before = structuredClone(loadStore()), oldPath = process.env.PATH
  const repo = join(own, 'live-cli-repo'), bin = join(own, 'live-cli-bin')
  mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true })
  const node = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true })
  git(['init', '-b', 'main']); git(['config', 'user.name', 'CLI fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  writeFileSync(join(repo, 'README.md'), '# Live CLI fixture\n'); git(['add', '.']); git(['commit', '-m', 'Initial fixture'])
  const plan = { size: 'medium', summary: 'Two workers and final integration.', agents: [
    { id: 'one', title: 'First worker', prompt: 'Implement first.txt', files: ['first.txt'], dependsOn: [] },
    { id: 'two', title: 'Second worker', prompt: 'Implement second.txt', files: ['second.txt'], dependsOn: [] }
  ] }
  const fixture = join(bin, 'cli.cjs')
  writeFileSync(fixture, `const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const args = process.argv.slice(2), codex = args.includes('--fixture-codex');
if (args.includes('--version')) { console.log('fixture 1.0'); process.exit(0); }
if (!process.stdin.isTTY) {
  process.stdin.resume(); process.stdin.on('end', () => {
    const reply = JSON.stringify(${JSON.stringify(plan)});
    if (codex) { console.log(JSON.stringify({type:'thread.started',thread_id:crypto.randomUUID()})); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:reply}})); console.log(JSON.stringify({type:'turn.completed'})); }
    else console.log(JSON.stringify({type:'result',subtype:'success',result:reply,total_cost_usd:0.01,num_turns:1}));
  }); return;
}
const assignmentDir = ${JSON.stringify(join(own, 'task-assignments'))};
const name = fs.readdirSync(assignmentDir).find(name => args.join(' ').includes(name));
if (!name) throw new Error('CLI did not receive its assignment file');
const prompt = fs.readFileSync(path.join(assignmentDir, name), 'utf8');
if (!process.cwd().startsWith(${JSON.stringify(join(repo, '.claude', 'worktrees'))})) throw new Error('CLI outside shared worktree');
const sessionId = codex ? crypto.randomUUID() : args[args.indexOf('--session-id') + 1];
let hookUrl, rollout;
if (!codex) {
  const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
  hookUrl = settings.hooks.Stop[0].hooks[0].command.match(new RegExp('http://127[.]0[.]0[.]1:[0-9]+/hook/[a-zA-Z0-9_-]+/[a-f0-9]+'))[0];
} else {
  const now = new Date(), dir = path.join(process.env.CODEX_HOME,'sessions',String(now.getFullYear()),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0'));
  fs.mkdirSync(dir,{recursive:true}); rollout = path.join(dir,'rollout-fixture-' + sessionId + '.jsonl');
  fs.writeFileSync(rollout, JSON.stringify({type:'session_meta',payload:{id:sessionId,cwd:process.cwd()},timestamp:now.toISOString()})+'\\n');
}
const hook = (event, reply) => {
  if (codex) { process.stdout.write('\\x1b]7501;state='+(event === 'Stop' ? 'done' : 'working')+':app=codex\\x07'); return; }
  const req = require('node:http').request(hookUrl,{method:'POST',headers:{'Content-Type':'application/json'}},res => res.resume());
  req.on('error',error => console.error(error.message)); req.end(JSON.stringify({hook_event_name:event,session_id:sessionId,last_assistant_message:reply}));
};
function turn() {
  hook('UserPromptSubmit');
  setTimeout(() => {
    const target = prompt.includes('Implement first.txt') && !prompt.includes('final integration agent') ? 'first.txt' : prompt.includes('Implement second.txt') && !prompt.includes('final integration agent') ? 'second.txt' : null;
    if (target) fs.writeFileSync(target,'Scoped implementation\\n');
    const reply = target ? 'Implemented ' + target : 'Integration verified both files.';
    if (codex) fs.appendFileSync(rollout,[{type:'event_msg',payload:{type:'task_started'}},{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:reply}]}}].map(e=>JSON.stringify(e)).join('\\n')+'\\n');
    console.log(reply); hook('Stop', reply);
  },150);
}
console.log('LIVE_CLI_READY ' + (codex ? 'codex' : 'claude'));
process.stdin.setRawMode(true); process.stdin.setEncoding('utf8');
process.stdin.on('data', s => { process.stdout.write('[key:' + s + ']'); turn(); });
turn();`)
  writeFileSync(join(bin, 'claude.cmd'), `@echo off\r\n"${node}" "${fixture}" %*\r\n`)
  writeFileSync(join(bin, 'codex.cmd'), `@echo off\r\n"${node}" "${fixture}" --fixture-codex %*\r\n`)
  process.env.PATH = `${bin};${oldPath ?? ''}`
  const js = (code: string) => win.webContents.executeJavaScript(code).catch(err => { log('live CLI renderer failure:', code); throw err })
  const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (label: string, test: () => boolean | Promise<boolean>) => {
    for (let n = 0; n < 200; n++) { if (await test()) return; await pause() }
    throw new Error(`Live CLI smoke timed out: ${label}`)
  }
  const click = async (selector: string, label: string) => {
    await until(`button ${label}`, () => js(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`))
    await js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) throw new Error('Missing enabled button: ' + ${JSON.stringify(label)}); b.click(); })()`)
  }
  const shot = async (suffix: string) => { await pause(200); writeFileSync(outFile.replace(/\.png$/, `-${suffix}.png`), (await win.webContents.capturePage()).toPNG()) }
  try {
    updateStore(s => { s.manualProjects.push(repo); s.settings.queueEnabled = false; s.settings.queuePauseAtPercent = 0; s.projectMeta[normalizePath(repo)] = { tags: [], notes: '', checkCommand: `& '${node.replace(/'/g, "''")}' -e "if (!require('fs').existsSync('first.txt') || !require('fs').existsSync('second.txt')) process.exit(1)"` } })
    win.show(); win.focus(); win.webContents.setBackgroundThrottling(false); win.setSize(1440, 900)
    await until('renderer', () => js('!!window.__mcSmoke'))
    await js('window.__mcSmoke.refresh(); window.__mcSmoke.setView("tasks")')
    for (const tool of ['claude', 'codex'] as const) {
      win.setSize(1440, 900)
      const root = createTask({ title: `Live ${tool} team`, prompt: 'Implement two scoped files and verify integration.', tool, mode: 'headless', permission: 'auto', projectPath: repo, projectName: 'CLI fixture', useWorktree: false })
      await until('task loaded', () => js(`window.__mcSmoke.tasks().some(t => t.id === '${root.id}')`))
      await js(`window.__mcSmoke.openTask('${root.id}')`)
      await until('split control', () => js(`!!document.querySelector('[aria-label="Agent team execution"]')`))
      if (await js(`document.querySelector('[aria-label="Agent team execution"]').value`) !== 'interactive') throw new Error('Live CLI is not the default split mode')
      await click('.drawer-actions button', 'Split into agents')
      await until('structured plan', () => root.team?.phase === 'ready')
      await until('task workspace', () => js('!!document.querySelector(".task-agent-workspace") && !document.querySelector(".drawer")'))
      await js(`document.querySelector('[aria-label="Task and team controls"]').click()`)
      await until('team controls', () => js('!!document.querySelector(".team-panel")'))
      await click('.team-panel-actions button', 'Start 2 agents')
      const workers = () => listTasks().filter(t => t.teamParentId === root.id && t.teamRole === 'worker')
      await until(`${tool} CLI replies`, () => workers().length === 2 && workers().every(t => t.run?.cliState === 'idle' && !!t.run.sessionId))
      const ids = workers().map(t => t.run!.agentId)
      const pane = (id: string) => `document.querySelector('.task-term[data-task-id="${id}"]')`
      const text = (id: string) => `(${pane(id)}?.querySelector('.xterm-rows')?.textContent ?? '')`
      await until('real TUI visible', () => js(`${text(workers()[0].id)}.includes('LIVE_CLI_READY ${tool}')`))
      for (const worker of workers()) {
        await js(`${pane(worker.id)}.querySelector('.xterm-helper-textarea').focus()`)
        win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' })
        await until('typed input', () => js(`${text(worker.id)}.includes('[key:x]')`))
        await until('follow-up reply', () => worker.run?.cliState === 'idle')
        await pause(250)
        if (await js(`${text(worker.id)}.split('[key:x]').length - 1`) !== 1) throw new Error('CLI input was duplicated')
      }
      const integrator = listTasks().find(t => t.teamParentId === root.id && t.teamRole === 'integrator')!
      if (integrator.run) throw new Error('Integration started before assignments were released')
      await click('.tasks-layout-switch button', 'Board')
      await click('.task-card button', 'View all CLI agents')
      await until('same CLI identities', () => js('!!document.querySelector(".view-pane:not(.hidden) .task-agent-workspace")'))
      if (JSON.stringify(workers().map(t => t.run!.agentId)) !== JSON.stringify(ids)) throw new Error('Navigation restarted task CLIs')
      for (const theme of ['dark', 'light']) {
        await js(`if (document.documentElement.dataset.theme !== '${theme}') window.__mcSmoke.runShortcut('toggleTheme')`)
        for (const width of [1440, 960]) {
          win.setSize(width, width === 960 ? 600 : 900); await pause(250)
          await click('.task-agent-layout button', 'Grid')
          if (await js(`(() => { const el=document.querySelector('.task-agent-workspace'); return el.scrollWidth-el.clientWidth })()`) > 1) throw new Error('Live workspace overflows')
          await shot(`${tool}-${theme}-${width}`)
        }
      }
      await click('.task-agent-layout button', 'Tabs')
      for (const worker of workers()) {
        await js(`document.querySelector('[data-member-id="${worker.id}"]').click()`)
        await click(`.task-term[data-task-id="${worker.id}"] .task-cli-controls button`, 'Finish assignment')
        await until('worker completed', () => worker.column === 'review')
        if (worker.run?.error) throw new Error(worker.run.error)
      }
      await until('integration reply', () => integrator.run?.cliState === 'idle' && !!integrator.run.sessionId)
      await js(`document.querySelector('[data-member-id="${integrator.id}"]').click()`)
      await click(`.task-term[data-task-id="${integrator.id}"] .task-cli-controls button`, 'Finish assignment')
      await until('team review', () => root.team?.phase === 'review')
      if (!root.run?.commit || root.run.checks?.status !== 'passed') throw new Error('Live team did not complete checks and commit')
      log(`live ${tool} team: PASS — actual PTYs, typed follow-ups once, view navigation, manual completion, dependencies, integration/checks/commit, both themes and widths`)
    }
    if (runningTaskCount() !== 0) throw new Error('Live team left running assignments')
  } catch (err) {
    await shot('failure')
    log('live CLI pane text:', await js(`[...document.querySelectorAll('.task-term')].map(t => ({id:t.dataset.taskId, hidden:t.className, text:t.querySelector('.xterm-rows')?.textContent?.slice(0,1500)}))`))
    throw err
  } finally {
    for (const task of listTasks()) if (task.team?.mode === 'interactive' && task.team.phase === 'running') stopTaskTeam(task.id)
    process.env.PATH = oldPath
    updateStore(s => Object.assign(s, before))
  }
}
