import type { BrowserWindow } from 'electron'
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { execFileSync } from 'node:child_process'
import { projectReview, startCodeReview } from './projectReview'
import workerPath from './indexWorker?modulePath'
import { createTask, startTask, followUpTask, deleteTask, listTasks, setTaskRun } from './tasks'
import { saveTemplate, runTemplate, deleteTemplate } from './templates'
import { dependencyState } from '../shared/deps'

export async function codexTasksSmoke(win: BrowserWindow, outFile: string, log: (...v: unknown[]) => void) {
  win.show(); win.webContents.setBackgroundThrottling(false)
  const root = mkdtempSync(join(tmpdir(), 'mc-codex-tasks-'))
  if (process.env.MC_SMOKE_CODEX_TASKS === 'review') {
    execFileSync('git', ['init', root], { windowsHide: true })
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Smoke'], { windowsHide: true })
    execFileSync('git', ['-C', root, 'config', 'user.email', 'smoke@example.invalid'], { windowsHide: true })
    writeFileSync(join(root, 'math.js'), 'export const add = (a, b) => a + b;\n')
    execFileSync('git', ['-C', root, 'add', '.'], { windowsHide: true })
    execFileSync('git', ['-C', root, 'commit', '-m', 'initial'], { windowsHide: true })
    writeFileSync(join(root, 'math.js'), 'export const add = (a, b) => a - b;\n')
    await startCodeReview(root, undefined, 'codex')
    const task = listTasks().find(t => t.projectPath === root)!
    try {
      for (let i = 0; i < 120 && !task.run?.finishedAt; i++) await new Promise(r => setTimeout(r, 1000))
      if (!task.run?.finishedAt || task.run.error || !task.run.result || !task.run.toolCalls) throw new Error('Real code review failed: ' + task.run?.error)
      if ((await projectReview(root)).reviewStale) throw new Error('Read-only reviewer changed files')
      log('real code review: tools, result and unchanged source passed', task.run.result.slice(0, 220))
    } finally { await deleteTask(task.id) }
    return
  }
  const pause = (ms = 100) => new Promise(r => setTimeout(r, ms))
  const until = async (test: () => boolean) => { for (let i = 0; i < 1200; i++) { if (test()) return; await pause() }; throw new Error('Codex task timed out') }
  const created: string[] = []
  const base = { projectPath: root, projectName: 'Codex task test', mode: 'headless' as const, permission: 'plan' as const, useWorktree: false, tool: 'codex' as const }
  try {
    const task = createTask({ ...base, title: 'Codex smoke', prompt: 'Reply with exactly first-check. Do not use tools.' })
    created.push(task.id)
    if (process.env.MC_SMOKE_CODEX_TASKS === 'fixtures') setTaskRun(task.id, { sessionId: 'fixture-id', result: 'first-check', startedAt: Date.now(), finishedAt: Date.now(), events: [], toolCalls: 0 }, 'review')
    else { await startTask(task.id); await until(() => !!task.run?.finishedAt) }
    if (task.run?.error || !task.run?.sessionId || !task.run.result?.includes('first-check')) throw new Error('Codex run failed: ' + task.run?.error)
    const session = task.run.sessionId
    if (process.env.MC_SMOKE_CODEX_TASKS === 'fixtures') setTaskRun(task.id, { result: 'resumed-check' }, 'review')
    else { followUpTask(task.id, 'Reply with exactly resumed-check. Do not use tools.'); await until(() => !!task.run?.finishedAt) }
    if (task.run?.error || task.run?.sessionId !== session || !task.run?.result?.includes('resumed-check')) throw new Error('Codex resume failed: ' + task.run?.error)
    const dependent = createTask({ ...base, title: 'Dependent review', prompt: 'Review only', dependsOn: [task.id], whenReady: 'none' })
    created.push(dependent.id)
    if (dependencyState(dependent, listTasks()).kind !== 'ready') throw new Error('Codex completion did not unblock dependency')
    const capped = createTask({ ...base, title: 'Unsupported cap', prompt: 'Do not run', budgetUsd: 1 })
    created.push(capped.id)
    let rejected = false
    try { await startTask(capped.id) } catch { rejected = true }
    if (!rejected || capped.column !== 'todo') throw new Error('Unsupported budget was ignored')
    const template = saveTemplate({ ...base, tool: 'claude', name: 'Mixed pipeline smoke', title: 'Build', prompt: 'Build', model: 'sonnet', budgetUsd: 1, steps: [{ title: 'Review', prompt: 'Review', tool: 'codex', permission: 'plan' }] })
    try {
      const first = await runTemplate(template.id, 'todo')
      const pipeline = listTasks().filter(t => t.templateId === template.id)
      created.push(...pipeline.map(t => t.id))
      const second = pipeline.find(t => t.dependsOn?.includes(first.id))
      if (second?.tool !== 'codex' || second.permission !== 'plan' || second.model || second.budgetUsd) throw new Error('Mixed-agent pipeline leaked Claude settings')
    } finally { deleteTemplate(template.id) }
    await win.webContents.executeJavaScript(`new Promise(resolve => { const check = () => document.querySelector('.project-name') ? resolve(true) : setTimeout(check, 50); check() })`)
    await win.webContents.executeJavaScript(`window.__mcSmoke.setView('tasks')`)
    await pause(500)
    win.show()
    writeFileSync(outFile, (await win.webContents.capturePage()).toPNG())
    log(`Codex tasks: ${process.env.MC_SMOKE_CODEX_TASKS === 'fixtures' ? 'fixture UI' : 'real run and resume'}, dependencies, mixed pipeline and USD cap rejection passed`)
  } finally { for (const id of created) { try { await deleteTask(id) } catch {} } }
  await searchSmoke(root, log)
}

async function searchSmoke(root: string, log: (...v: unknown[]) => void) {
  const claude = join(root, 'claude'), codex = join(root, 'codex')
  mkdirSync(claude); mkdirSync(codex)
  const id = '00000000-0000-4000-8000-000000000001'
  const file = join(codex, `rollout-test-${id}.jsonl`)
  const line = (e: object) => JSON.stringify({ timestamp: new Date().toISOString(), ...e }) + '\n'
  writeFileSync(file, line({ type: 'session_meta', payload: { cwd: 'C:\\test-project' } }) + line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'goldensearch prompt' }] } }) + line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'goldensearch answer' }] } }))
  const worker = new Worker(workerPath, { workerData: { dbPath: join(root, 'test.db'), projectsDir: claude, codexSessionsDir: codex } })
  let request = 0
  const query = (op: string, ...args: unknown[]): Promise<any> => new Promise((resolve, reject) => {
    const id = ++request
    const timer = setTimeout(() => { worker.off('message', listener); reject(new Error('Index query timeout')) }, 10000)
    const listener = (m: any) => { if (m.type === 'result' && m.id === id) { clearTimeout(timer); worker.off('message', listener); m.error ? reject(new Error(m.error)) : resolve(m.result) } }
    worker.on('message', listener); worker.postMessage({ type: 'query', id, op, args })
  })
  try {
    for (let i = 0; i < 100; i++) { if ((await query('status')).lastRun) break; await new Promise(r => setTimeout(r, 100)) }
    const hits = await query('search', 'goldensearch', {})
    if (hits.length !== 2 || hits.some((h: any) => h.projectKey !== 'codex')) throw new Error('Codex index missing or duplicated')
    if ((await query('search', 'goldensearch', { projectPath: 'C:\\other' })).length) throw new Error('Project filter leaked')
    if ((await query('search', 'goldensearch', { projectPath: 'C:\\test-project', role: 'assistant' })).length !== 1) throw new Error('Project/role filter failed')
    const extra = line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'goldensearch appended' }] } })
    appendFileSync(file, extra.slice(0, -1))
    worker.postMessage({ type: 'run' }); await new Promise(r => setTimeout(r, 300))
    if ((await query('search', 'goldensearch', {})).length !== 2) throw new Error('Partial line indexed prematurely')
    appendFileSync(file, '\n'); worker.postMessage({ type: 'run' }); await new Promise(r => setTimeout(r, 300))
    if ((await query('search', 'goldensearch', {})).length !== 3) throw new Error('Incremental append failed')
    worker.postMessage({ type: 'run' }); await new Promise(r => setTimeout(r, 200))
    if ((await query('search', 'goldensearch', {})).length !== 3) throw new Error('Index duplicated unchanged messages')
    log('Codex search: full text, project/role filters, partial lines and incremental dedupe passed')
  } finally { await worker.terminate() }
}
