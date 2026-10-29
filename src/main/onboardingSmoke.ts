import { app, type BrowserWindow } from 'electron'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { loadStore, updateStore } from './store'
import { normalizePath } from './claudeData'
import type { ReadinessResult } from '../shared/readiness'
import type { Task } from '../shared/types'

let fixture: { root: string; bin: string; repo: string; plain: string; state: string; sentinel: string } | undefined
const secret = 'ONBOARDING_PRIVATE_TOKEN_DO_NOT_DISPLAY'
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message) }

/** Runs at import time, before ready/renderer/background tasks. No fallback to an installed provider. */
export function prepareOnboardingSmoke(): void {
  assert(process.platform === 'win32', 'Onboarding CLI fixtures currently require Windows')
  const restart = process.env.MC_SMOKE_ONBOARDING === 'restart'
  assert(process.env.MC_SMOKE && (restart || process.env.MC_SMOKE_CLEAN === '1'), 'Require MC_SMOKE and MC_SMOKE_CLEAN=1 for the initial tour')
  assert(!restart || !process.env.MC_SMOKE_CLEAN, 'Unset MC_SMOKE_CLEAN for restart: clean startup resets fixture settings')
  const root = resolve(process.env.MC_SMOKE_PROFILE ?? '')
  assert(root.toLowerCase().startsWith((resolve(tmpdir()) + sep + 'mc-onboarding-').toLowerCase()), 'Profile must be a dedicated TEMP/mc-onboarding-* directory')
  assert(restart ? existsSync(join(root, 'onboarding-checkpoint.json')) : !existsSync(join(root, 'store.json')), 'Use a fresh profile, or restart only a completed fixture profile')
  mkdirSync(root, { recursive: true })
  // TEMP projects are intentionally excluded by the production composer as scratch folders.
  // Keep this uniquely named disposable repository adjacent to TEMP, never in a personal project.
  const bin = join(root, 'fixture-bin'), repo = join(dirname(tmpdir()), basename(root) + '-repositories', 'project'), plain = join(root, 'plain-folder')
  const state = join(root, 'fixture-state.json'), sentinel = join(root, 'provider-invocations.jsonl')
  mkdirSync(bin, { recursive: true }); mkdirSync(repo, { recursive: true }); mkdirSync(plain, { recursive: true })
  const locate = (tool: string) => execFileSync('where.exe', [tool], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
  const node = locate('node'), git = locate('git')
  assert(existsSync(node) && existsSync(git), 'Node and Git must be installed before running this tour')
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  // Restrict PATH instead of prepending to a real provider search path.
  const safePath = [bin, system, dirname(git)].join(';')
  for (const dir of [system, dirname(git)]) for (const tool of ['claude', 'codex']) for (const ext of ['.exe', '.cmd', '.bat']) assert(!existsSync(join(dir, tool + ext)), 'A real provider exists in a required system/Git directory; refusing tour')
  writeFileSync(state, JSON.stringify({ auth: 'ready', task: 'success' }))
  const script = join(bin, 'provider.cjs')
  writeFileSync(script, `const fs = require('node:fs'), path = require('node:path');
const tool = process.argv[2], args = process.argv.slice(3), state = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const record = kind => fs.appendFileSync(${JSON.stringify(sentinel)}, JSON.stringify({ fixture:true, tool, kind, cwd:process.cwd() })+'\\n');
if (args.includes('--version')) { record('version'); console.log(tool+' 1.2.3 ${secret}'); process.exit(0); }
if (args[0] === 'auth' || args[0] === 'login') {
 record('auth');
 if (state.auth === 'slow') { setTimeout(()=>process.exit(9), 20000); return; }
 if (state.auth === 'offline') { console.error('ENETUNREACH ${secret}'); process.exit(1); }
 if (state.auth === 'unknown') { console.log('${secret} unsupported status'); process.exit(0); }
 console.log(tool === 'claude' ? JSON.stringify({loggedIn:state.auth==='ready',token:'${secret}'}) : state.auth === 'ready' ? 'Logged in using ChatGPT' : 'Not logged in'); process.exit(state.auth === 'ready' ? 0 : 1);
}
if (tool === 'package-manager') { record('FORBIDDEN_PACKAGE_COMMAND'); process.exit(96); }
let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s=>input+=s);
process.stdin.on('end', ()=>{
 if (!input.includes('ONBOARDING_FIXTURE_TASK')) { record('REFUSED_UNEXPECTED_PROMPT'); process.exit(97); }
 const cwd = path.resolve(process.cwd()), repo = ${JSON.stringify(repo)};
 if (cwd !== repo && !cwd.startsWith(repo+path.sep)) { record('REFUSED_OUTSIDE_FIXTURE'); process.exit(98); }
 record('task-'+state.task);
 const emit = e=>console.log(JSON.stringify(e));
 if (tool==='codex') { emit({type:'thread.started',thread_id:'onboarding-fixture-thread'}); emit({type:'item.started',item:{type:'command_execution',command:'Inspect fixture'}}); }
 else emit({type:'assistant',message:{content:[{type:'text',text:'Inspecting local fixture project'}]}});
 if(state.task==='interrupt') { setInterval(()=>{},1000); return; }
 setTimeout(()=>{
  if(state.task==='failure') { console.error('Local fixture task failed deliberately'); process.exit(2); }
  if(!input.includes('READ_ONLY')) fs.appendFileSync('README.md','\\nOnboarding fixture change.\\n');
  const result='Local fixture task completed without a provider call.';
  if(tool==='codex') { emit({type:'item.completed',item:{type:'agent_message',text:result}}); emit({type:'turn.completed'}); }
  else emit({type:'result',subtype:'success',result,total_cost_usd:0,num_turns:1});
 },1800);
});`)
  for (const tool of ['claude', 'codex', 'npm', 'pnpm', 'yarn', 'bun']) writeFileSync(join(bin, tool + '.cmd'), `@echo off\r\n"${node}" "${script}" ${['claude', 'codex'].includes(tool) ? tool : 'package-manager'} %*\r\n`)
  // Prove both wrappers run the local interpreter before replacing PATH.
  for (const tool of ['claude', 'codex']) {
    const probe = spawnSync(join(system, 'cmd.exe'), ['/d', '/s', '/c', `""${join(bin, tool + '.cmd')}" --version"`], { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', timeout: 5000 })
    assert(probe.status === 0 && probe.stdout.includes('1.2.3'), 'Fixture CLI self-test failed; refusing fallback')
  }
  process.env.PATH = safePath
  process.env.CODEX_HOME = join(root, 'codex-home')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude-home')
  // Ignore personal/global Git hooks, signing and credential helpers in all fixture children.
  writeFileSync(join(root, 'empty-gitconfig'), '')
  process.env.GIT_CONFIG_GLOBAL = join(root, 'empty-gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  // Additional defense: no inherited API credentials or remote endpoints in child processes.
  for (const key of Object.keys(process.env)) if (/^(ANTHROPIC_|OPENAI_|AZURE_OPENAI_|CLAUDE_CODE_OAUTH_TOKEN)/.test(key)) delete process.env[key]
  if (!restart) {
    const runGit = (...args: string[]) => execFileSync(git, ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + join(root, 'empty-hooks'), '-C', repo, ...args], { windowsHide: true, timeout: 10000, stdio: 'pipe' })
    runGit('init', '-b', 'main'); runGit('config', 'user.name', 'Onboarding fixture'); runGit('config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(repo, 'README.md'), '# Local onboarding fixture\n')
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { dev: 'node SHOULD_NOT_RUN.cjs', test: 'node SHOULD_NOT_RUN.cjs' } }))
    writeFileSync(join(repo, 'SHOULD_NOT_RUN.cjs'), `require('fs').writeFileSync('FORBIDDEN_COMMAND_RAN', 'failure')`)
    runGit('add', '.'); runGit('commit', '-m', 'Initial local fixture')
  }
  fixture = { root, bin, repo, plain, state, sentinel }
}

/** Native renderer + preload + IPC + production probes and runner; never injects readiness or progress. */
export async function onboardingSmoke(win: BrowserWindow, outFile: string, log: (...v: unknown[]) => void): Promise<void> {
  assert(fixture, 'Fixture bootstrap did not run')
  const { root, bin, repo, plain, state, sentinel } = fixture
  const js = async <T = any>(code: string): Promise<T> => {
    const value = await win.webContents.executeJavaScript(`(async()=>{try{return await (async()=>{${code.startsWith('if(') ? code : 'return ' + code}})()}catch(e){return {__smokeFailure:String(e.message)}}})()`)
    if (value?.__smokeFailure) throw new Error('Renderer: ' + value.__smokeFailure)
    return value as T
  }
  const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (test: () => boolean | Promise<boolean>, label: string) => {
    const end = Date.now() + 20000
    while (Date.now() < end) { if (await test()) return; await pause() }
    throw new Error('Onboarding timed out: ' + label)
  }
  const passed: string[] = [], defects: string[] = []
  let privateConsoleOutput = false
  win.webContents.on('console-message', (event, _level, message) => {
    const output = typeof message === 'string' ? message : (event as unknown as { message?: string }).message
    if (output?.includes(secret)) privateConsoleOutput = true
  })
  const pass = (message: string) => { passed.push(message); log('onboarding verified:', message) }
  const setState = (auth = 'ready', task = 'success') => writeFileSync(state, JSON.stringify({ auth, task }))
  const click = (selector: string, label: string) => until(() => js(`(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}); if(!e || e.disabled) return false; e.click(); return true })()`), `enabled control: ${label}`)
  const fill = async (selector: string, value: string) => {
    await js(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing input'); const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true})) })()`)
    await pause(150)
  }
  let serial = 0
  const connections = (providers: ('claude' | 'codex')[] = ['claude', 'codex']) => js<ReadinessResult>(`window.mc.checkConnections(${JSON.stringify({ requestId: 'onboarding-' + ++serial, providers, force: true })})`)
  const project = (path: string) => js<ReadinessResult>(`window.mc.checkProjectReadiness(${JSON.stringify({ requestId: 'project-' + ++serial, projectPath: path, requireHistory: true })})`)
  const shot = async (name: string) => { await pause(200); writeFileSync(outFile.replace(/\.png$/, `-${name}.png`), (await win.webContents.capturePage()).toPNG()) }
  const assertPrivate = async () => {
    assert(!privateConsoleOutput, 'Sensitive diagnostic output leaked into renderer console')
    assert(!(await js<string>('document.body.innerText')).includes(secret), 'Sensitive diagnostic output leaked into UI')
    if (process.env.MC_SMOKE_LOG && existsSync(process.env.MC_SMOKE_LOG)) assert(!readFileSync(process.env.MC_SMOKE_LOG, 'utf8').includes(secret), 'Sensitive diagnostic output leaked into smoke log')
    for (const name of readdirSync(root).filter(name => name.endsWith('.log'))) assert(!readFileSync(join(root, name), 'utf8').includes(secret), 'Sensitive diagnostic output leaked into captured application log')
  }
  try {
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  win.webContents.setBackgroundThrottling(false); win.show(); win.focus()
  await until(() => js('!!window.__mcSmoke'), 'renderer smoke interface')
  if (process.env.MC_SMOKE_ONBOARDING === 'restart') {
    const saved = JSON.parse(readFileSync(join(root, 'onboarding-checkpoint.json'), 'utf8'))
    const setup = await js('window.mc.getGuidedSetup()'), settings = await js('window.mc.getSettings()')
    assert(setup.status === saved.status && JSON.stringify(setup.providers) === JSON.stringify(saved.providers), 'Setup did not persist across process restart')
    assert(settings.userName === 'Onboarding preserved user' && loadStore().manualProjects.includes(repo), 'Existing settings/project lost after restart')
    await js('window.__mcSmoke.openSetup()'); await until(() => js('!!document.querySelector(".setup-surface")'), 'resume after restart')
    await assertPrivate(); pass('actual process restart preserves setup, settings, project and resume')
    return
  }
  updateStore(s => {
    s.settings.autoBriefings = false; s.settings.queueEnabled = false; s.settings.autoUpdate = false
    s.settings.userName = 'Onboarding preserved user'
    s.manualProjects.push(repo)
    s.projectMeta[normalizePath(repo)] = { tags: ['preserve-me'], notes: 'Existing fixture metadata', commands: [{ id: 'preserved', name: 'Existing command', command: 'echo existing' }] }
  })
  await js('window.__mcSmoke.refresh()')
  await until(() => js(`window.mc.listProjects().then(p=>p.some(p=>p.path===${JSON.stringify(repo)}))`), 'fixture project')
  await js('window.__mcSmoke.openSetup()'); await until(() => js('!!document.querySelector(".setup-surface")'), 'setup dialog')
  for (const providers of [['claude'], ['codex'], ['claude', 'codex']] as ('claude' | 'codex')[][]) {
    // Wait for each persisted selection before changing the next controlled checkbox.
    for (const tool of providers) {
      await js(`(() => { const e=[...document.querySelectorAll('.setup-surface fieldset label')].find(e=>e.textContent.toLowerCase()===${JSON.stringify(tool)})?.querySelector('input'); if(e&&!e.checked)e.click() })()`)
      await until(() => js(`window.mc.getGuidedSetup().then(s=>s.providers.includes(${JSON.stringify(tool)}))`), 'provider selected')
      await pause()
    }
    for (const tool of ['claude', 'codex'].filter(t => !providers.includes(t as 'claude' | 'codex'))) {
      await js(`(() => { const e=[...document.querySelectorAll('.setup-surface fieldset label')].find(e=>e.textContent.toLowerCase()===${JSON.stringify(tool)})?.querySelector('input'); if(e?.checked)e.click() })()`)
      await until(() => js(`window.mc.getGuidedSetup().then(s=>!s.providers.includes(${JSON.stringify(tool)}))`), 'provider deselected')
      await pause()
    }
    await until(() => js(`window.mc.getGuidedSetup().then(s=>JSON.stringify([...s.providers].sort())===${JSON.stringify(JSON.stringify([...providers].sort()))})`), 'provider selection saved')
    assert((await connections(providers)).outcome === 'ready', 'Selected provider checks failed')
    pass(providers.join('+') + ' visible selection and real CLI diagnostics')
  }
  for (const mode of ['signed-out', 'unknown', 'offline']) {
    setState(mode)
    const result = await connections()
    assert(result.outcome !== 'ready' && result.checks.some(c => c.reason === (mode === 'signed-out' ? 'signed_out' : mode === 'unknown' ? 'auth_unknown' : 'offline')), 'Auth uncertainty mislabeled: ' + mode)
    assert(!JSON.stringify(result).includes(secret), 'Raw diagnostic content leaked through IPC')
    pass(mode + ' remains actionable and unverified')
  }
  renameSync(join(bin, 'codex.cmd'), join(bin, 'codex.disabled'))
  try { assert((await connections(['codex'])).checks.some(c => c.reason === 'tool_missing'), 'Missing tool fell back to a real CLI') } finally { renameSync(join(bin, 'codex.disabled'), join(bin, 'codex.cmd')) }
  setState('slow')
  const pending = js<ReadinessResult>(`window.mc.checkConnections({requestId:'cancel-onboarding',providers:['claude']})`)
  await pause(250); await js(`window.mc.cancelReadiness('cancel-onboarding')`)
  assert((await pending).outcome === 'cancelled', 'Cancellation did not reach subprocess probe')
  setState('slow')
  const stale = js<ReadinessResult>(`window.mc.checkConnections({requestId:'superseded-onboarding',providers:['claude']})`)
  await pause(250); setState()
  assert((await connections(['claude'])).outcome === 'ready' && (await stale).outcome === 'stale', 'Superseded probe replaced fresh results')
  setState('slow')
  assert((await connections(['claude'])).checks.some(c => c.reason === 'timeout' && c.outcome === 'unavailable'), 'Timed-out auth was labeled successful')
  setState(); assert((await connections()).outcome === 'ready', 'Recheck did not recover')
  pass('missing executable, child cancellation, supersession, bounded timeout and fresh recheck recovery')
  const providerPath = process.env.PATH
  try {
    process.env.PATH = [bin, join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')].join(';')
    assert((await connections()).checks.some(c => c.id === 'git.installation' && c.reason === 'tool_missing'), 'Missing Git was labeled ready or not checked')
  } finally { process.env.PATH = providerPath }
  assert((await connections()).outcome === 'ready', 'Git recheck failed after restoring fixture PATH')
  pass('missing Git requirement and verified recovery without initializing a repository')
  setState('signed-out'); await click('.setup-surface button', 'Recheck connections')
  await until(() => js(`document.querySelector('.setup-surface').innerText.includes('reports no login')`), 'failed connections visible')
  await click('.setup-surface button', 'Skip setup for now')
  assert((await js('window.mc.getGuidedSetup()')).status === 'skipped', 'Skip not persisted')
  await js(`window.__mcSmoke.setView('inbox')`)
  await until(() => js(`document.querySelectorAll('.guidance-problems li').length>0`), 'Fix problems connection failures')
  await shot('problems')
  setState(); await click('.guidance-problems button', 'Recheck')
  await until(() => js(`![...document.querySelectorAll('.guidance-problems h3')].some(e=>/authentication|installation/.test(e.textContent))`), 'verified connection problems removed')
  await assertPrivate(); pass('real UI failure, skip, Fix problems recheck and automatic removal')
  await js(`(() => {document.querySelector('.setup-sidebar-entry').focus(); document.querySelector('.setup-sidebar-entry').click()})()`)
  await until(() => js('!!document.querySelector(".setup-surface")'), 'resume')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); await pause()
  assert(await js(`document.querySelector('.setup-surface').contains(document.activeElement)`), 'Keyboard focus escaped setup')
  await js(`(() => { const nodes=document.querySelector('.setup-surface').querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]');nodes[nodes.length-1].focus() })()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); await pause()
  assert(await js(`document.activeElement===document.querySelector('.setup-surface button')`), 'Tab did not wrap within setup')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] }); await pause()
  assert(await js(`document.activeElement.textContent==='Skip setup for now'`), 'Shift+Tab did not wrap within setup')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await until(() => js('!document.querySelector(".setup-surface")'), 'keyboard dismiss')
  assert(await js(`document.activeElement===document.querySelector('.setup-sidebar-entry')`), 'Setup did not return focus to opener')
  assert((await js('window.mc.getGuidedSetup()')).status === 'dismissed', 'Dismiss not persisted')
  pass('keyboard Tab/Shift+Tab trap, Escape dismissal, opener focus return and persisted resume state')
  const original = readFileSync(join(repo, 'package.json'), 'utf8')
  assert((await project(plain)).checks.some(c => c.reason === 'not_repository'), 'Non-Git folder reported ready')
  assert(!existsSync(join(plain, '.git')), 'Readiness initialized Git')
  writeFileSync(join(plain, 'package.json'), '{broken')
  assert((await project(plain)).checks.some(c => c.reason === 'manifest_invalid'), 'Malformed JSON accepted')
  // A separate unsupported manifest fixture does not require deleting or moving any user paths.
  const unsupported = join(root, 'unsupported'); mkdirSync(unsupported); writeFileSync(join(unsupported, 'Cargo.toml'), '[package]\nname="fixture"')
  assert((await project(unsupported)).checks.some(c => c.reason === 'manifest_unsupported'), 'Unsupported manifest accepted')
  const valid = await project(repo)
  assert(valid.outcome === 'ready' && valid.suggestions.length === 2, 'Git/package scripts not detected')
  assert(readFileSync(join(repo, 'package.json'), 'utf8') === original && !existsSync(join(repo, 'node_modules')), 'Readiness mutated project')
  pass('non-Git, malformed/unsupported manifests, valid history and read-only command inference')
  await js(`(() => { window.__mcSmoke.selectProject(${JSON.stringify(repo)}); window.__mcSmoke.setView('project') })()`)
  await until(() => js('!!document.querySelector(".project-readiness")'), 'project readiness UI')
  await click('.project-readiness button', 'Recheck project readiness')
  await until(() => js(`document.querySelector('.project-readiness').getAttribute('aria-busy')==='false'`), 'project verification')
  await click('.project-readiness button', 'Review project commands')
  await until(() => js(`!!document.querySelector('[aria-label="Detected command suggestions"]')`), 'command suggestions')
  await click('.run-editor button', 'Review suggestion')
  await until(() => js('!!document.querySelector(".run-editor textarea")'), 'command editor')
  await fill('.run-editor textarea', 'node SHOULD_NOT_RUN.cjs --reviewed')
  await click('.run-editor button', 'Save command')
  await until(() => (loadStore().projectMeta[normalizePath(repo)].commands ?? []).some(c => c.command.endsWith('--reviewed')), 'edited suggestion saved')
  assert(loadStore().projectMeta[normalizePath(repo)].commands?.some(c => c.id === 'preserved'), 'Saving suggestion removed existing command')
  assert(!existsSync(join(repo, 'FORBIDDEN_COMMAND_RAN')) && !existsSync(join(repo, 'node_modules')), 'Suggestion saving executed code')
  pass('suggestion edited and saved through renderer without execution; existing commands preserved')
  await js('window.__mcSmoke.openSetup()')
  await until(() => js('!!document.querySelector(".setup-surface .first-task-guide")'), 'starter task guide')
  await click('.setup-surface .first-task-guide button', 'Edit starter task')
  await until(() => js('!!document.querySelector(".composer")'), 'task composer')
  await click('.composer .segmented button', 'Claude')
  await until(() => js(`!![...document.querySelector('.composer select').options].find(e=>e.value===${JSON.stringify(repo)})`), 'fixture project available in composer')
  await fill('.composer .prompt-input', 'ONBOARDING_FIXTURE_TASK create a small local README change')
  await fill('.composer select', repo)
  await js(`(() => { const label=[...document.querySelectorAll('.composer label')].find(e=>e.textContent.includes('Permissions')); const e=label.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'acceptEdits');e.dispatchEvent(new Event('change',{bubbles:true}));const wt=document.querySelector('.composer .check-row input');if(!wt.checked)wt.click() })()`)
  await pause(250)
  await until(() => js(`!![...document.querySelectorAll('.composer button')].find(e=>e.textContent.trim()==='Add to To do'&&!e.disabled)`), 'valid composer choices')
  await click('.composer button', 'Add to To do')
  await until(() => js(`window.mc.listTasks().then(ts=>ts.some(t=>t.prompt.includes('ONBOARDING_FIXTURE_TASK')))`), 'task creation')
  const task: Task = (await js<Task[]>('window.mc.listTasks()')).find(t => t.prompt.includes('ONBOARDING_FIXTURE_TASK'))!
  assert(task.permission === 'acceptEdits' && task.useWorktree, 'Explicit task choices were not saved')
  await js(`window.mc.startTask(${JSON.stringify(task.id)})`)
  await until(() => js(`window.mc.listTasks().then(ts=>ts.find(t=>t.id===${JSON.stringify(task.id)})?.run?.events.some(e=>e.kind==='text'))`), 'live child progress')
  await js(`window.__mcSmoke.openTask(${JSON.stringify(task.id)})`); await shot('task-progress')
  await until(() => js(`window.mc.listTasks().then(ts=>!!ts.find(t=>t.id===${JSON.stringify(task.id)})?.run?.finishedAt)`), 'task result')
  const finished = (await js<Task[]>('window.mc.listTasks()')).find(t => t.id === task.id)!
  assert(!finished.run?.error && finished.worktree && !readFileSync(join(repo, 'README.md'), 'utf8').includes('fixture change'), 'Worktree task failed or changed main folder')
  await until(() => js(`document.querySelector('.drawer')?.textContent.includes('Local fixture task completed without a provider call.')`), 'final result displayed in task drawer')
  await pause(150)
  await click('.drawer-tabs button', 'Changes')
  await until(() => js(`!!document.querySelector('.diff-add')`), 'real diff review')
  await shot('diff-review'); pass('composer permission/isolation, real streamed progress, result and Git diff review')
  await js(`document.querySelector('.review-approval input').click()`)
  await until(() => js(`[...document.querySelectorAll('.first-task-guide [role="status"]')].some(e=>e.textContent.includes('You inspected this run'))`), 'guide observes acknowledged review')
  await js(`(() => { window.__mcSmoke.openTask(null); window.__mcSmoke.openSetup() })()`)
  await until(() => js(`document.querySelector('.setup-surface .first-task-guide [role="status"]')?.textContent.includes('You inspected this run')`), 'guide completes from result and acknowledged diff snapshot')
  pass('first-task guidance completes from actual result and explicit current-diff review without merging or marking done')
  assert((await js<Task[]>('window.mc.listTasks()')).find(t => t.id === task.id)?.column === 'review', 'Guide completion changed task review state')
  await click('.setup-surface button', 'Dismiss setup')
  // Both providers execute real local children; failure, interruption and retry use production task IPC.
  for (const mode of ['failure', 'interrupt', 'success']) {
    setState('ready', mode)
    const item: Task = await js(`window.mc.createTask(${JSON.stringify({ title: 'Codex local ' + mode, prompt: 'ONBOARDING_FIXTURE_TASK READ_ONLY', tool: 'codex', projectPath: repo, projectName: 'Fixture', permission: 'plan', useWorktree: false, mode: 'headless' })})`)
    await js(`window.mc.startTask(${JSON.stringify(item.id)})`)
    if (mode === 'interrupt') { await pause(500); await js(`window.mc.stopTask(${JSON.stringify(item.id)})`) }
    await until(() => js(`window.mc.listTasks().then(ts=>!!ts.find(t=>t.id===${JSON.stringify(item.id)})?.run?.finishedAt)`), mode + ' completion')
    const result: Task = (await js<Task[]>('window.mc.listTasks()')).find(t => t.id === item.id)!
    assert(mode === 'success' ? !result.run?.error : !!result.run?.error, 'Task outcome incorrect: ' + mode)
    if (mode !== 'success') {
      await js(`(() => {window.__mcSmoke.openTask(null);window.__mcSmoke.setView('inbox')})()`)
      await until(() => js(`!![...document.querySelectorAll('.guidance-problems button')].find(e=>e.textContent==='Retry task')`), 'failed task problem action')
      setState(); await click('.guidance-problems button', 'Retry task')
      await until(() => js(`window.mc.listTasks().then(ts=>!!ts.find(t=>t.id===${JSON.stringify(item.id)})?.run?.finishedAt)`), 'retry result')
      assert(!(await js<Task[]>('window.mc.listTasks()')).find(t => t.id === item.id)?.run?.error, 'Retry did not recover')
      await until(() => js(`![...document.querySelectorAll('.guidance-problems h3')].some(e=>e.textContent.includes('task run'))`), 'successful retry automatically resolves task problem')
    }
  }
  pass('Codex local stream, deliberate failure, interrupted child, Fix problems Retry and verified removal')
  await js('(() => { window.__mcSmoke.openTask(null); window.__mcSmoke.openSetup() })()')
  await until(() => js('!!document.querySelector(".setup-surface")'), 'visual setup')
  for (const theme of ['dark', 'light']) {
    await js(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})window.__mcSmoke.runShortcut('toggleTheme')`)
    win.setSize(960, 600); await pause(250)
    assert(win.getSize().join('x') === '960x600', 'Actual minimum window size not exercised')
    const overflow = await js<number>(`Math.max(document.documentElement.scrollWidth-document.documentElement.clientWidth,document.querySelector('.setup-surface').scrollWidth-document.querySelector('.setup-surface').clientWidth)`)
    if (overflow > 1) defects.push(`Setup horizontal overflow ${overflow}px at 960x600 (${theme})`)
    await shot('setup-' + theme + '-960x600')
  }
  await assertPrivate()
  assert(loadStore().settings.userName === 'Onboarding preserved user' && loadStore().manualProjects.includes(repo) && loadStore().projectMeta[normalizePath(repo)].notes === 'Existing fixture metadata', 'Setup changed existing profile data')
  const invocations = readFileSync(sentinel, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  assert(invocations.every(e => e.fixture === true && !e.kind.startsWith('FORBIDDEN') && !e.kind.startsWith('REFUSED')), 'Unexpected provider/package execution; inspect isolated sentinel')
  assert(invocations.some(e => e.tool === 'claude' && e.kind.startsWith('task-')) && invocations.some(e => e.tool === 'codex' && e.kind.startsWith('task-')), 'Missing provider fixture execution evidence')
  pass('restricted CLI sentinel, secret sanitization, command non-execution and profile preservation')
  const setup = await js('window.mc.updateGuidedSetup({status:"dismissed",providers:["claude","codex"]})')
  writeFileSync(join(root, 'onboarding-checkpoint.json'), JSON.stringify({ status: setup.status, providers: setup.providers }))
  writeFileSync(join(root, 'onboarding-report.json'), JSON.stringify({ passed, defects, fixtureRepository: repo, limitations: ['Command inference supports root package.json only', 'Restart evidence requires the second documented invocation'] }, null, 2))
  if (defects.length) throw new Error(defects.join('; '))
  log('onboarding fixture tour: PASS for recorded assertions; run restart phase for persistence evidence')
  } catch (error) {
    // Keep partial evidence even when an early integration regression prevents later assertions.
    // Never serialize arbitrary child output or errors into the diagnostic report.
    await shot('failure').catch(() => undefined)
    writeFileSync(join(root, 'onboarding-failure.json'), JSON.stringify({ passed, defects, fixtureRepository: repo, status: 'failed', lastVerified: passed.at(-1) ?? null }, null, 2))
    throw error
  }
}
