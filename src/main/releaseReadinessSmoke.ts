import { app, type BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listProjects, normalizePath } from './claudeData'
import { loadStore, updateStore } from './store'
import { createTask, deleteTask, listTasks, rerunChecks, runningTaskCount, setTaskRun, startTask, stopAllTasks } from './tasks'
import { projectRuns, startConfiguredCommand, stopAllProjectCommands } from './projectCommands'

/** Native release gates. No model calls; the runtime agent is a local CLI fixture. */
export async function releaseReadinessSmoke(win: BrowserWindow, outFile: string, log: (...v: unknown[]) => void) {
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (fn: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200; i++) { if (await fn()) return; await pause() }
    throw new Error('Release readiness condition timed out')
  }
  const shot = async (suffix: string) => {
    win.show(); win.focus()
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await win.webContents.capturePage(); await pause(300)
    writeFileSync(outFile.replace(/\.png$/, `-${suffix}.png`), (await win.webContents.capturePage()).toPNG())
  }
  win.show(); win.webContents.setBackgroundThrottling(false)
  await until(() => js('!!window.__mcSmoke'))
  if (process.env.MC_SMOKE_READINESS === 'first-run') {
    if ((await listProjects()).length) throw new Error('First-run test must have no discovered projects')
    await until(() => js(`document.querySelectorAll('.connection-details a').length === 2`))
    await shot('setup')
    await js(`window.__mcSmoke.runShortcut('newSession')`)
    await until(() => js(`!!document.querySelector('input[placeholder="e.g. my-new-app"]')`))
    await js(`document.querySelector('.dialog button[aria-label="Close"]').click()`)
    await js(`document.querySelector('[aria-label="Open terminal for setup commands"]').click()`)
    await until(() => js(`window.__mcSmoke.agents().some(a => a.title === 'Setup terminal')`))
    const agent = await js(`window.__mcSmoke.agents().find(a => a.title === 'Setup terminal')`)
    if (agent.cwd !== app.getPath('home') || agent.kind !== 'shell') throw new Error('Setup terminal requires a project')
    await js(`window.__setupOutput = ''; window.__setupOff = window.mc.onPtyData((id,data) => { if(id === ${JSON.stringify(agent.id)}) window.__setupOutput += data }); window.mc.ptyWrite(${JSON.stringify(agent.id)}, "Write-Output ('MC_SETUP_' + 'READY')\\r")`)
    try { await until(() => js(`window.__setupOutput.includes('MC_SETUP_READY')`)) }
    catch (e) { log('setup terminal output:', await js(`window.__setupOutput`)); await shot('terminal-error'); throw e }
    await js(`window.__setupOff(); window.__mcSmoke.closeAgent(${JSON.stringify(agent.id)}); window.__mcSmoke.setView('home'); void 0`)
    // Sample project metadata for public screenshots; no real user's chats or paths.
    const sample = join(app.getPath('userData'), 'sample-project')
    mkdirSync(sample, { recursive: true }); writeFileSync(join(sample, 'README.md'), '# Sample project\nA place for your next project.\n')
    updateStore(s => { s.manualProjects = [sample]; s.projectMeta[normalizePath(sample)] = { tags: [], notes: '', displayName: 'Sample project', status: 'active', preferredAgent: 'codex' } })
    await js('window.__mcSmoke.refresh()'); await pause(500)
    await shot('home-dark')
    await js(`window.__mcSmoke.runShortcut('toggleTheme')`); await pause(300)
    await shot('home-light')
    log('first run: missing CLIs, setup guides, New session guidance, project-free shell and sanitized screenshots: PASS')
    return
  }

  const dir = join(app.getPath('userData'), 'runtime-fixtures')
  mkdirSync(dir, { recursive: true })
  const originalPath = process.env.PATH
  const old = structuredClone(loadStore().projectMeta)
  const fixture = join(dir, 'claude.cmd')
  writeFileSync(fixture, '@echo off\r\nif exist "%~dp0finish.flag" (\r\necho changed>agent.txt\r\necho {"type":"result","subtype":"success","result":"Fixture complete","is_error":false}\r\nexit /b 0\r\n)\r\npowershell.exe -NoProfile -Command "Start-Sleep -Seconds 60"\r\n')
  process.env.PATH = `${dir};${originalPath}`
  const task = createTask({ title: 'Release fixture', projectPath: dir, projectName: 'Release checks', prompt: 'fixture', mode: 'headless', permission: 'plan', useWorktree: false })
  try {
    const first = startTask(task.id)
    let duplicate = false
    try { await startTask(task.id) } catch { duplicate = true }
    if (!duplicate) throw new Error('Duplicate starting task accepted')
    await first
    const pidFile = join(dir, 'descendant.pid')
    const command = `$child = Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '${pidFile.replace(/'/g, "''")}' -Value $child.Id -Encoding ascii; Start-Sleep -Seconds 60`
    updateStore(s => { s.projectMeta[normalizePath(dir)] = { tags: [], notes: '', checkCommand: command } })
    const check = createTask({ title: 'Check fixture', projectPath: dir, projectName: 'Release checks', prompt: 'fixture', mode: 'headless', permission: 'plan', useWorktree: false })
    setTaskRun(check.id, { finishedAt: Date.now(), result: 'Fixture result' }, 'review')
    const pending = rerunChecks(check.id)
    let checkDuplicate = false
    try { await rerunChecks(check.id) } catch { checkDuplicate = true }
    if (!checkDuplicate || runningTaskCount() < 2) throw new Error('Checks not guarded or counted as running')
    await until(() => existsSync(pidFile))
    const descendant = Number(readFileSync(pidFile, 'utf8').trim())
    // Reproduce a completed agent still awaiting its worktree commit when shutdown begins.
    const git = process.env.MC_SMOKE_GIT!
    const gitArgs = (args: string[]) => execFileSync(git, ['-C', dir, ...args], { windowsHide: true, stdio: 'ignore' })
    gitArgs(['init']); gitArgs(['config', 'user.email', 'release-check@example.invalid']); gitArgs(['config', 'user.name', 'Release check'])
    writeFileSync(join(dir, 'README.md'), '# Release fixture\n'); gitArgs(['add', 'README.md']); gitArgs(['commit', '-m', 'initial'])
    const committing = join(dir, 'commit.ready'), lateCheck = join(dir, 'late-check.ran')
    const hookScript = `Set-Content -LiteralPath '${committing.replace(/'/g, "''")}' -Value ready; Start-Sleep -Seconds 2`
    const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').replace(/\\/g, '/')
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\n"${powershell}" -NoProfile -EncodedCommand ${Buffer.from(hookScript, 'utf16le').toString('base64')}\n`)
    writeFileSync(join(dir, 'finish.flag'), 'ready')
    updateStore(s => { s.projectMeta[normalizePath(dir)].checkCommand = `Set-Content -LiteralPath '${lateCheck.replace(/'/g, "''")}' -Value unexpected` })
    const late = createTask({ title: 'Commit-race fixture', projectPath: dir, projectName: 'Release checks', prompt: 'fixture', mode: 'headless', permission: 'plan', useWorktree: true })
    await startTask(late.id)
    await until(() => existsSync(committing))
    const run = startConfiguredCommand(dir, { id: 'long', name: 'Quit command fixture', command: 'Start-Sleep -Seconds 60' })
    if (!projectRuns(dir).some(r => r.id === run.id)) throw new Error('Command not tracked')
    stopAllTasks(); stopAllProjectCommands()
    await pending
    await until(() => !!late.run?.finishedAt)
    if (existsSync(lateCheck) || late.run?.checks?.status !== 'error') throw new Error('Checks started after shutdown during a worktree commit')
    await until(() => run.state === 'stopped')
    let remains = true
    try { process.kill(descendant, 0) } catch { remains = false }
    if (remains) throw new Error(`Orphaned command descendant: ${descendant}`)
    let closingRejected = false
    try { await startTask(task.id) } catch { closingRejected = true }
    if (!closingRejected) throw new Error('Task started during shutdown')
    for (const item of listTasks().filter(t => t.projectPath === dir)) if (item.column !== 'running') deleteTask(item.id)
    log('runtime: duplicate starts/checks, active check count, process-tree shutdown, commit/shutdown race and post-shutdown start rejection: PASS')
  } finally {
    process.env.PATH = originalPath
    stopAllTasks(); stopAllProjectCommands()
    updateStore(s => { s.projectMeta = old })
  }
}
