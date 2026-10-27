import { execFileSync } from 'node:child_process'
import { mergeReviewedWorktree, projectReview, startReviewChecks } from './projectReview'
import { commitAll, createWorktree, removeWorktree } from './git'
import type { BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { draftProjectBriefing, saveProjectBriefing, projectBriefing, briefingContext } from './projectBriefing'
import { loadStore, updateStore } from './store'
import { normalizePath } from './claudeData'
import { projectCommandReport, projectRuns, startProjectCommand, stopProjectCommand } from './projectCommands'

export async function projectCommandsSmoke(win: BrowserWindow, outFile: string, log: (...v: unknown[]) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'mc-run-'))
  const before = loadStore()
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
  const shot = async (file: string) => {
    win.show(); win.focus()
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await win.webContents.capturePage()
    await pause(300)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
  }
  const until = async (test: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200; i++) { if (await test()) return; await pause() }
    throw new Error('Run panel smoke timed out')
  }
  updateStore(s => { s.manualProjects.push(dir) })
  try {
    win.show(); win.webContents.setBackgroundThrottling(false)
    await until(() => js('!!window.__mcSmoke'))
    await js(`window.__mcSmoke.refresh()`)
    await js(`window.__mcSmoke.selectProject(${JSON.stringify(dir)}); window.__mcSmoke.setView('project')`)
    await until(() => js(`!![...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.trim() === 'Run')`))
    const tabs: string[] = await js(`[...document.querySelectorAll('.page-tabs button')].map(b => b.textContent.trim().split(/\\s/)[0])`)
    if (tabs.join(',') !== 'Overview,Chats,Run,Changes,Briefing,Docs') throw new Error('Project tab order changed')
    await js(`[...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.trim() === 'Run').click()`)
    await until(() => js(`!!document.querySelector('.run-toolbar button')`))
    await js(`document.querySelector('.run-toolbar button').click()`)
    await pause()
    await js(`(() => {
      const input = document.querySelector('.run-editor input'), area = document.querySelector('.run-editor textarea');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Failing check'); input.dispatchEvent(new Event('input', {bubbles:true}));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'Write-Output "streamed"; Start-Sleep -Seconds 2; Write-Output "failure detail"; exit 7'); area.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    await pause()
    await js(`document.querySelector('.run-editor button[type=submit]').click()`)
    await until(() => js(`!!document.querySelector('.run-command')`))
    const command = loadStore().projectMeta[normalizePath(dir)].commands![0]
    await js(`document.querySelector('.run-command button[aria-label^="Run "]').click()`)
    await until(() => projectRuns(dir).some(r => r.output.includes('streamed') && r.state === 'running'))
    let duplicateBlocked = false
    try { startProjectCommand(dir, command.id) } catch { duplicateBlocked = true }
    if (!duplicateBlocked) throw new Error('Duplicate run allowed')
    await js(`window.__mcSmoke.setView('home')`)
    await until(() => projectRuns(dir).some(r => r.state === 'failed'))
    await js(`window.__mcSmoke.setView('project')`)
    await until(() => js(`document.querySelector('.run-output')?.textContent.includes('failure detail')`))
    if (projectRuns(dir)[0].exitCode !== 7) throw new Error('Exit code lost')
    if (projectRuns(dir)[0].output.includes('CLIXML')) throw new Error('PowerShell XML leaked into output')
    const report = projectCommandReport(projectRuns(dir)[0].id)
    const reportPath = JSON.parse(report.prompt.match(/"(?:[^"\\]|\\.)*"/)![0])
    if (report.prompt.length > 1000 || !readFileSync(reportPath, 'utf8').includes('failure detail')) throw new Error('Command report lost output')
    await pause(400)
    await shot(outFile)
    log('run panel: saved command, live output, duplicate guard, page switch and exit 7 passed')
    updateStore(s => { s.projectMeta[normalizePath(dir)].commands!.push({ id: 'long', name: 'Long command', command: 'Write-Output "working"; Start-Sleep -Seconds 60' }, { id: 'large', name: 'Large output', command: 'Write-Output ("a" * 100000); exit 0' }) })
    const long = startProjectCommand(dir, 'long')
    await until(() => long.output.includes('working'))
    stopProjectCommand(long.id)
    await until(() => long.state === 'stopped')
    const large = startProjectCommand(dir, 'large')
    await until(() => large.state === 'passed')
    if (large.output.length > 65536) throw new Error('Unbounded output')
    log('run panel: stop process, success and output limit passed')
    log('run panel: PASS')
    const draft = await draftProjectBriefing(dir)
    if (projectBriefing(dir).markdown) throw new Error('Preview wrote a file')
    saveProjectBriefing(dir, '# Shared goal\nKeep this decision.\n\n' + draft.markdown.slice(draft.markdown.indexOf('<!-- mission-control-recent -->')))
    const updated = await draftProjectBriefing(dir)
    if (!updated.markdown.includes('Keep this decision.') || !updated.markdown.includes('Large output: passed')) throw new Error('Briefing refresh lost context')
    if (!briefingContext(dir, 'Next task').includes('docs')) throw new Error('Briefing not included')
    await js(`[...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.trim() === 'Briefing').click()`)
    await until(() => js(`document.querySelector('.briefing-editor')?.value.includes('Keep this decision.')`))
    log('project briefing: preview, save, manual decisions, check results and UI passed')
    execFileSync('git', ['init', dir], {windowsHide:true})
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'smoke@example.invalid'], {windowsHide:true})
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Smoke'], {windowsHide:true})
    writeFileSync(join(dir, 'app.txt'), 'before\n')
    execFileSync('git', ['-C', dir, 'add', '.'], {windowsHide:true})
    execFileSync('git', ['-C', dir, 'commit', '-m', 'initial'], {windowsHide:true})
    updateStore(s => {s.projectMeta[normalizePath(dir)].checkCommand = 'Write-Output "checks passed"; exit 0'})
    writeFileSync(join(dir, 'app.txt'), 'after\n')
    await startReviewChecks(dir)
    await until(async () => (await projectReview(dir)).check?.state === 'passed')
    if ((await projectReview(dir)).checkStale) throw new Error('Fresh checks marked stale')
    writeFileSync(join(dir, 'app.txt'), 'changed again\n')
    if (!(await projectReview(dir)).checkStale) throw new Error('Stale checks reported passing for changed files')
    log('review: real git snapshot, checks and invalidation after source edits passed')
    await commitAll(dir, 'prepare worktree test')
    const wt = await createWorktree(dir)
    try {
      updateStore(s => { s.projectMeta[normalizePath(dir)].commands!.push({ id: 'cwd', name: 'Current folder', command: '$PWD.Path' }) })
      const folderRun = startProjectCommand(dir, 'cwd', wt.path)
      await until(() => folderRun.state === 'passed')
      if (!folderRun.output.toLowerCase().includes(wt.path.toLowerCase())) throw new Error('Saved command ran outside worktree')
      let outsideRejected = false
      try { startProjectCommand(dir, 'cwd', join(dir, '..')) } catch { outsideRejected = true }
      if (!outsideRejected) throw new Error('Unrelated command folder accepted')
      log('dock run: saved root command runs in worktree; unrelated folder rejected')
      writeFileSync(join(wt.path, 'app.txt'), 'agent change\n')
      await commitAll(wt.path, 'agent change')
      await startReviewChecks(wt.path, wt.base)
      await until(async () => (await projectReview(wt.path, wt.base)).check?.state === 'passed')
      const reviewed = await projectReview(wt.path, wt.base)
      writeFileSync(join(wt.path, 'app.txt'), 'changed after review\n')
      let rejected = false
      try { await mergeReviewedWorktree(wt, reviewed.fingerprint) } catch { rejected = true }
      if (!rejected) throw new Error('Stale review merged')
      await commitAll(wt.path, 'later change')
      const changed = await projectReview(wt.path, wt.base)
      rejected = false
      try { await mergeReviewedWorktree(wt, changed.fingerprint) } catch { rejected = true }
      if (!rejected) throw new Error('Stale checks merged')
      await startReviewChecks(wt.path, wt.base)
      await until(async () => (await projectReview(wt.path, wt.base)).check?.state === 'passed')
      const ready = await projectReview(wt.path, wt.base)
      await mergeReviewedWorktree(wt, ready.fingerprint)
      if (!readFileSync(join(dir, 'app.txt'), 'utf8').includes('changed after review')) throw new Error('Reviewed merge lost changes')
      log('review merge: stale approval and stale checks blocked; fresh checked merge passed')
    } finally { await removeWorktree(wt) }
    await js(`window.__mcSmoke.refresh()`)
    await until(() => js(`!![...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.includes('Changes') && !b.disabled)`))
    await js(`[...document.querySelectorAll('.page-tabs button')].find(b => b.textContent.includes('Changes')).click()`)
    await js(`document.querySelector('[aria-label="Collapse project tools"]')?.click()`)
    await until(() => js(`!!document.querySelector('.review-summary')`))
    await until(() => js(`document.querySelector('.review-status-grid')?.textContent.includes('Out of date')`))
    if (await js(`!!document.querySelector('.review-output[open]')`)) throw new Error('Long review output expanded by default')
    await pause(300)
    await shot(outFile.replace(/\.png$/, '-review.png'))
    await js(`window.__mcSmoke.openComposer()`)
    await until(() => js(`!!document.querySelector('.composer')`))
    await js(`[...document.querySelectorAll('.composer .segmented button')].find(b => b.textContent === 'Codex').click()`)
    await pause(250)
    if (!(await js(`!!document.querySelector('.composer input[placeholder="Codex default model"]')`))) throw new Error('Codex task controls missing')
    await shot(outFile.replace(/\.png$/, '-task-composer.png'))
    await js(`document.querySelector('.composer button[aria-label="Close"]').click()`)
    // Output-driven status must return to idle after removing the old app-wide tick.
    await js(`window.__mcSmoke.launch({cwd:${JSON.stringify(dir)},projectPath:${JSON.stringify(dir)},projectName:'Run smoke shell',title:'Idle transition',kind:'shell'})`)
    await until(() => js(`!!document.querySelector('.agent-cell.focused .terminal-host')`))
    const shell = await js(`window.__mcSmoke.agents().at(-1)`)
    await js(`window.mc.ptyWrite(${JSON.stringify(shell.id)}, "Write-Output 'status test'\\r")`)
    await until(() => js(`document.querySelector('.agent-cell.focused .status-pill')?.textContent.includes('working')`))
    await until(() => js(`document.querySelector('.agent-cell.focused .status-pill')?.textContent.includes('idle')`))
    await js(`[...document.querySelectorAll('.agent-bar-end button')].find(b => b.textContent.trim() === 'Run').click()`)
    await until(() => js(`!!document.querySelector('.dock-run-stage [aria-label="Run Current folder"]')`))
    await js(`document.querySelector('.dock-run-stage [aria-label="Run Current folder"]').click()`)
    await until(() => js(`document.querySelector('.dock-run-stage .run-output')?.textContent.toLowerCase().includes(${JSON.stringify(dir.toLowerCase())})`))
    await shot(outFile.replace(/\.png$/, '-dock-run.png'))
    log('dock Run: opens under agent and streams saved command output in active folder')
    await js(`window.__mcSmoke.closeAgent(${JSON.stringify(shell.id)})`)
    log('UI: review summary, Codex task controls and shell working-to-idle transition passed')
  } finally {
    for (const run of projectRuns(dir)) stopProjectCommand(run.id)
    updateStore(s => { s.manualProjects = before.manualProjects; s.projectMeta = before.projectMeta })
  }
}
