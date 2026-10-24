import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { CheckResult, NewTask, QueueStatus, RateLimitInfo, Task, TaskColumn, TaskRun, WorktreeInfo } from '../shared/types'
import { chainBaseFor, dependencyState, dependentsOf, taskSucceeded, wouldCreateCycle } from '../shared/deps'
import { invalidateBudgets, projectBudget } from './budget'
import { normalizePath } from './claudeData'
import { commitIfDirty, createWorktree, gitInfo } from './git'
import { agentEnv, whichSync } from './pty'
import { loadStore, updateStore } from './store'
import { addEvent, applyStreamEvent } from './streamParser'
import { defaultModelFor, launchArgs } from './spend'

/**
 * The task board's data and the headless runner.
 *
 * Headless tasks run `claude -p --output-format stream-json` as a plain child process (no terminal);
 * the prompt goes in on stdin so no shell quoting is involved. Each stream event updates the task's
 * run (current activity, tool calls, cost), and the board is pushed to the UI.
 *
 * After a successful headless run: changes in its worktree are committed, the project's check
 * command runs, and tasks that were waiting on it start (from its branch when they use worktrees).
 */

const CHECK_TIMEOUT_MS = 10 * 60_000
const CHECK_OUTPUT_CHARS = 6000

interface Hooks {
  onChange: (tasks: Task[]) => void
  onRateLimit: (info: RateLimitInfo) => void
  onFinished: (task: Task) => void
  onQueueStatus: (status: QueueStatus) => void
  /** An interactive task's dependencies all succeeded; it needs you to open it. */
  onReady: (task: Task) => void
}

let tasks: Task[] = []
let hooks: Hooks | null = null
const procs = new Map<string, ChildProcess>()
const checkProcs = new Map<string, ChildProcess>()
const stoppedByUser = new Set<string>()
let lastRateLimit: RateLimitInfo | null = null

let saveTimer: NodeJS.Timeout | null = null
let emitTimer: NodeJS.Timeout | null = null

function persist(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    updateStore((s) => {
      s.tasks = tasks
    })
  }, 400)
}

function emit(): void {
  tasks = [...tasks]
  persist()
  if (emitTimer) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    hooks?.onChange(tasks)
  }, 80)
}

export function flushTasks(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  updateStore((s) => {
    s.tasks = tasks
  })
}

export function initTasks(h: Hooks): void {
  hooks = h
  tasks = loadStore().tasks
  // Runs and checks can't survive an app restart; say so on the card instead of showing a stale spinner.
  for (const t of tasks) {
    if (t.run?.checks?.status === 'running') {
      t.run.checks = { ...t.run.checks, status: 'error', output: `${t.run.checks.output}\n(Stopped when Mission Control closed.)`, finishedAt: Date.now() }
    }
    if (t.column === 'running') {
      t.column = 'review'
      if (t.run && !t.run.finishedAt) {
        t.run.finishedAt = Date.now()
        t.run.agentId = undefined
        t.run.error = t.run.error ?? 'Stopped when Mission Control closed. Resume it to continue.'
      }
    }
  }
  persist()
  // Re-check the queue now and then: a plan window may have reset since the last check.
  setInterval(pumpQueue, 30_000)
  setTimeout(pumpQueue, 3000)
}

// ---------------------------------------------------------------- guardrails

function busiestPlanPercent(): number {
  return Math.round(Math.max(0, ...(lastRateLimit?.windows.map((w) => w.utilization) ?? [])) * 100)
}

/** Why automation shouldn't start a task in this project right now, or null if it may. */
export async function automationHold(projectPath: string): Promise<string | null> {
  const s = loadStore().settings
  const plan = busiestPlanPercent()
  if (s.queuePauseAtPercent > 0 && plan >= s.queuePauseAtPercent) return `Plan usage is at ${plan}% (limit ${s.queuePauseAtPercent}%)`
  const budget = await projectBudget(projectPath)
  if (budget?.over) return `Project is over its monthly budget ($${budget.spent.toFixed(2)} of $${budget.budget})`
  return null
}

// ---------------------------------------------------------------- auto-queue

function queuedTasks(): Task[] {
  return tasks.filter((t) => t.column === 'todo' && t.queued && t.mode === 'headless' && dependencyState(t, tasks).kind !== 'waiting' && dependencyState(t, tasks).kind !== 'blocked').sort((a, b) => a.order - b.order)
}

export function queueStatus(): QueueStatus {
  const s = loadStore().settings
  const status: QueueStatus = {
    enabled: s.queueEnabled,
    parallel: s.queueParallel,
    queued: tasks.filter((t) => t.column === 'todo' && t.queued).length,
    running: procs.size
  }
  if (!s.queueEnabled) status.heldBecause = 'Auto-run is off'
  else {
    const plan = busiestPlanPercent()
    if (s.queuePauseAtPercent > 0 && plan >= s.queuePauseAtPercent) status.heldBecause = `Plan usage is at ${plan}% (limit ${s.queuePauseAtPercent}%)`
  }
  return status
}

let pumping = false

/** Starts queued tasks while there are free slots. Tasks of projects over budget wait. */
export async function pumpQueue(): Promise<void> {
  if (pumping || !hooks) return
  pumping = true
  try {
    const skipped = new Set<string>()
    for (;;) {
      const status = queueStatus()
      hooks.onQueueStatus(status)
      if (status.heldBecause || procs.size >= status.parallel) return
      const next = queuedTasks().find((t) => !skipped.has(t.id))
      if (!next) return
      const hold = await automationHold(next.projectPath)
      if (hold) {
        skipped.add(next.id)
        continue
      }
      next.queued = false
      try {
        await startTask(next.id)
      } catch (err) {
        // Couldn't even start (e.g. worktree creation failed): report it on the card.
        setTaskRun(next.id, { startedAt: Date.now(), finishedAt: Date.now(), toolCalls: 0, events: [], error: (err as Error).message }, 'review')
      }
    }
  } finally {
    pumping = false
  }
}

// ---------------------------------------------------------------- CRUD

export function listTasks(): Task[] {
  return tasks
}

export function getRateLimit(): RateLimitInfo | null {
  return lastRateLimit
}

/** New plan-limit numbers, from a task run or the account poll; keeps the plan details a task run doesn't carry. */
export function setRateLimit(info: RateLimitInfo): void {
  lastRateLimit = { ...lastRateLimit, ...info }
  hooks?.onRateLimit(lastRateLimit)
  hooks?.onQueueStatus(queueStatus())
}

function find(id: string): Task {
  const t = tasks.find((x) => x.id === id)
  if (!t) throw new Error('Task not found')
  return t
}

function nextOrder(column: TaskColumn): number {
  return Math.max(0, ...tasks.filter((t) => t.column === column).map((t) => t.order)) + 1
}

function moveTo(t: Task, column: TaskColumn): void {
  if (t.column === column) return
  t.column = column
  t.order = nextOrder(column)
  if (column !== 'todo') t.queued = false
}

export function createTask(input: NewTask): Task {
  const now = Date.now()
  const id = randomUUID()
  const dependsOn = [...new Set(input.dependsOn ?? [])].filter((d) => tasks.some((t) => t.id === d))
  if (wouldCreateCycle(id, dependsOn, tasks)) throw new Error('That would make the tasks wait on each other in a loop.')
  const task: Task = {
    ...input,
    // A task that doesn't pick a model uses its project's default, then the app's (Settings).
    model: input.model || defaultModelFor(input.projectPath, true),
    title: input.title.trim() || input.prompt.trim().split('\n')[0].slice(0, 80) || 'Untitled task',
    id,
    column: 'todo',
    createdAt: now,
    updatedAt: now,
    order: nextOrder('todo'),
    queued: input.mode === 'headless' && !!input.queued,
    dependsOn: dependsOn.length ? dependsOn : undefined,
    whenReady: dependsOn.length ? (input.whenReady ?? 'start') : undefined
  }
  tasks = [...tasks, task]
  emit()
  if (task.queued) void pumpQueue()
  // All its dependencies may already have succeeded.
  if (dependsOn.length) void startIfReady(task)
  return task
}

export function updateTask(id: string, patch: Partial<Task>): void {
  const t = find(id)
  if (patch.dependsOn && wouldCreateCycle(id, patch.dependsOn, tasks)) throw new Error('That would make the tasks wait on each other in a loop.')
  const column = patch.column
  delete patch.column
  if ('dueAt' in patch && patch.dueAt !== t.dueAt) t.remindedAt = undefined
  Object.assign(t, patch, { updatedAt: Date.now() })
  if (column) moveTo(t, column)
  emit()
  if ('queued' in patch || column) void pumpQueue()
}

/**
 * Unfinished tasks whose due time has passed and that haven't been reminded yet. Marks them as
 * reminded, so each reminder shows once (index.ts checks every minute).
 */
export function takeDueReminders(now = Date.now()): Task[] {
  const due = tasks.filter((t) => t.dueAt && t.dueAt <= now && !t.remindedAt && (t.column === 'todo' || t.column === 'running'))
  if (!due.length) return []
  for (const t of due) t.remindedAt = now
  emit()
  return due
}

export function deleteTask(id: string): void {
  stopTask(id)
  stopChecks(id)
  tasks = tasks.filter((t) => t.id !== id)
  // Tasks that waited on it no longer do (they don't start by themselves because of this).
  for (const t of tasks) {
    if (t.dependsOn?.includes(id)) {
      t.dependsOn = t.dependsOn.filter((d) => d !== id)
      if (t.dependsOn.length === 0) t.dependsOn = undefined
    }
  }
  emit()
}

export function setTaskRun(id: string, patch: Partial<TaskRun>, column?: TaskColumn): void {
  const t = find(id)
  t.run = { startedAt: Date.now(), toolCalls: 0, events: [], ...t.run, ...patch }
  if (column) moveTo(t, column)
  t.updatedAt = Date.now()
  emit()
  // An interactive task finishing can unblock others.
  if (column === 'review' || column === 'done') onTaskSettled(t)
}

// ---------------------------------------------------------------- running

export function claudeCommand(): { file: string; prefix: string[] } {
  const path = whichSync('claude')
  if (!path) throw new Error('claude was not found on PATH. Install Claude Code first.')
  if (/\.(cmd|bat)$/i.test(path)) return { file: 'cmd.exe', prefix: ['/c', path] }
  return { file: path, prefix: [] }
}

/**
 * Where a task runs: its existing worktree, a new one (starting from the branch of the task it waited on,
 * so it builds on that work), or the project folder.
 */
async function prepareFolder(t: Task): Promise<{ cwd: string; worktree?: WorktreeInfo }> {
  if (!t.useWorktree) return { cwd: t.projectPath }
  if (t.worktree && existsSync(t.worktree.path)) return { cwd: t.worktree.path, worktree: t.worktree }
  const parent = chainBaseFor(t, tasks)
  // Only build on the previous task's branch when both tasks work in the same repository.
  const sameRepo = !!parent?.worktree && normalizePath(parent.worktree.repoRoot) === normalizePath((await gitInfo(t.projectPath)).mainRoot ?? '')
  const wt = parent?.worktree && sameRepo
    ? await createWorktree(t.projectPath, { fromBranch: parent.worktree.branch, base: parent.worktree.base })
    : await createWorktree(t.projectPath)
  t.worktree = wt
  return { cwd: wt.path, worktree: wt }
}

export async function startTask(id: string): Promise<{ interactive?: { cwd: string; args: string[]; worktree?: WorktreeInfo } }> {
  const t = find(id)
  if (procs.has(id)) throw new Error('This task is already running.')
  const { cwd, worktree } = await prepareFolder(t)
  if (worktree) emit()

  if (t.mode === 'interactive') {
    // The UI opens the agent terminal; the prompt is passed as claude's first message.
    const args = [...(t.model ? ['--model', t.model] : []), '--permission-mode', t.permission, t.prompt]
    return { interactive: { cwd, args, worktree } }
  }

  const run: TaskRun = { sessionId: randomUUID(), startedAt: Date.now(), toolCalls: 0, events: [], activity: 'Starting…' }
  const parent = chainBaseFor(t, tasks)
  addEvent(run, 'start', `Started in ${cwd}${worktree ? ` (branch ${worktree.branch}${parent?.worktree && worktree.branch !== parent.worktree.branch ? `, building on ${parent.worktree.branch}` : ''})` : ''}`)
  t.run = run
  moveTo(t, 'running')
  t.updatedAt = Date.now()
  emit()
  runHeadless(t, cwd, t.prompt, { sessionId: run.sessionId })
  return {}
}

/** Continues a finished headless task's chat with a new prompt, in the same folder. */
export function followUpTask(id: string, prompt: string): void {
  const t = find(id)
  const run = t.run
  if (!run?.sessionId) throw new Error('This task has no chat to continue yet.')
  if (procs.has(id) || t.column === 'running') throw new Error('This task is still running.')
  if (!prompt.trim()) throw new Error('Write what Claude should do next.')
  const cwd = t.worktree && existsSync(t.worktree.path) ? t.worktree.path : t.projectPath
  run.costBefore = run.costUsd ?? 0
  run.followUps = (run.followUps ?? 0) + 1
  run.finishedAt = undefined
  run.error = undefined
  run.result = undefined
  run.checks = undefined
  run.activity = 'Starting…'
  addEvent(run, 'info', `Follow-up: ${prompt.trim()}`)
  moveTo(t, 'running')
  t.updatedAt = Date.now()
  emit()
  runHeadless(t, cwd, prompt.trim(), { resume: run.sessionId })
}

function runHeadless(t: Task, cwd: string, prompt: string, session: { sessionId?: string; resume?: string }): void {
  const run = t.run!
  const { file, prefix } = claudeCommand()
  const budget = t.budgetUsd ?? (loadStore().settings.defaultTaskBudgetUsd || undefined)
  const args = [
    ...prefix,
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    ...(session.resume ? ['--resume', session.resume] : ['--session-id', session.sessionId!]),
    '--permission-mode',
    t.permission,
    ...(budget ? ['--max-budget-usd', String(budget)] : []),
    ...(t.model ? ['--model', t.model] : []),
    // Only the MCP servers this project loads (when you limited them).
    ...launchArgs(cwd, { newChat: false, hasModel: true })
  ]
  if (budget && !t.budgetUsd) addEvent(run, 'info', `Default budget $${budget} applies`)

  const child = spawn(file, args, { cwd, env: agentEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  procs.set(t.id, child)
  child.stdin.end(prompt)

  let buffer = ''
  let stderr = ''
  let sawResult = false
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      const out = applyStreamEvent(run, e, t.permission)
      if (out.final) sawResult = true
      if (out.rateLimit) setRateLimit({ ...out.rateLimit, source: 'task', error: undefined })
    }
    t.updatedAt = Date.now()
    emit()
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000)
  })

  const finish = async (code: number | null, spawnError?: Error) => {
    if (!procs.has(t.id)) return
    procs.delete(t.id)
    if (stoppedByUser.delete(t.id)) {
      run.error = 'Stopped by you.'
      addEvent(run, 'info', 'Stopped')
    } else if (spawnError) {
      run.error = spawnError.message
    } else if (!sawResult && !run.error) {
      run.error = stderr.trim().split('\n').slice(-3).join('\n') || `claude exited with code ${code}`
    }
    if (run.error) addEvent(run, 'error', run.error)
    run.activity = run.error ? 'Stopped' : 'Finished'

    if (!run.error) {
      await afterSuccess(t, cwd)
    }
    run.finishedAt = Date.now()
    // Whatever happened, the next step is yours: review the result.
    moveTo(t, 'review')
    t.updatedAt = Date.now()
    emit()
    invalidateBudgets()
    hooks?.onFinished(t)
    onTaskSettled(t)
    // A slot just opened up.
    void pumpQueue()
  }
  child.on('error', (err) => void finish(null, err))
  child.on('close', (code) => void finish(code))
}

/** Commit the worktree's changes, then run the project's checks. */
async function afterSuccess(t: Task, cwd: string): Promise<void> {
  const run = t.run!
  if (t.worktree && cwd === t.worktree.path) {
    run.activity = 'Committing changes…'
    emit()
    try {
      const hash = await commitIfDirty(cwd, `${t.title}\n\nMade by a Mission Control task.`)
      if (hash) {
        run.commit = hash
        addEvent(run, 'info', `Committed changes as ${hash} on ${t.worktree.branch}`)
      }
    } catch (err) {
      addEvent(run, 'info', `Couldn't commit the changes: ${(err as Error).message.split('\n')[0]}`)
    }
  }
  await runChecks(t, cwd)
}

// ---------------------------------------------------------------- checks

function checkCommandFor(t: Task): string | undefined {
  return loadStore().projectMeta[normalizePath(t.projectPath)]?.checkCommand?.trim() || undefined
}

/** Runs the project's check command in the task's folder; exit code 0 means passed. */
async function runChecks(t: Task, cwd: string): Promise<void> {
  const command = checkCommandFor(t)
  const run = t.run
  if (!command || !run) return
  const checks: CheckResult = { command, status: 'running', output: '', startedAt: Date.now() }
  run.checks = checks
  run.activity = `Checking: ${command}`
  addEvent(run, 'info', `Running checks: ${command}`)
  emit()

  await new Promise<void>((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, env: agentEnv(), windowsHide: true })
    checkProcs.set(t.id, child)
    const timer = setTimeout(() => {
      checks.output += `\n(Stopped after ${CHECK_TIMEOUT_MS / 60_000} minutes.)`
      killTree(child)
    }, CHECK_TIMEOUT_MS)
    const append = (chunk: Buffer) => {
      checks.output = (checks.output + chunk.toString('utf8')).slice(-CHECK_OUTPUT_CHARS)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const done = (code: number | null, err?: Error) => {
      if (!checkProcs.has(t.id)) return resolve()
      checkProcs.delete(t.id)
      clearTimeout(timer)
      checks.exitCode = code ?? undefined
      checks.finishedAt = Date.now()
      checks.status = err ? 'error' : code === 0 ? 'passed' : 'failed'
      if (err) checks.output += `\n${err.message}`
      addEvent(run, checks.status === 'passed' ? 'result' : 'error', checks.status === 'passed' ? 'Checks passed' : `Checks ${checks.status} (exit code ${code ?? '?'})`)
      run.activity = checks.status === 'passed' ? 'Finished · checks passed' : 'Finished · checks failed'
      resolve()
    }
    child.on('error', (err) => done(null, err))
    child.on('close', (code) => done(code))
  })
  emit()
}

/** Runs the checks again (e.g. after fixing the command); unblocks waiting tasks if they now pass. */
export async function rerunChecks(id: string): Promise<void> {
  const t = find(id)
  if (!t.run) throw new Error('This task hasn’t run yet.')
  if (t.column === 'running') throw new Error('Wait until the task has finished.')
  if (!checkCommandFor(t)) throw new Error('This project has no check command. Set one in its Overview tab.')
  const cwd = t.worktree && existsSync(t.worktree.path) ? t.worktree.path : t.projectPath
  await runChecks(t, cwd)
  onTaskSettled(t)
}

function stopChecks(id: string): void {
  const child = checkProcs.get(id)
  if (child) killTree(child)
}

// ---------------------------------------------------------------- dependencies

/** A task finished (or its checks changed): start the tasks that were waiting on it, if they're now ready. */
function onTaskSettled(t: Task): void {
  if (!taskSucceeded(t)) return
  for (const dep of dependentsOf(t.id, tasks)) void startIfReady(dep)
}

async function startIfReady(t: Task): Promise<void> {
  if (t.column !== 'todo' || dependencyState(t, tasks).kind !== 'ready') return
  const mode = t.whenReady ?? 'start'
  if (mode === 'none') return
  if (t.mode === 'interactive') {
    hooks?.onReady(t)
    return
  }
  if (mode === 'queue') {
    t.queued = true
    emit()
    void pumpQueue()
    return
  }
  const hold = await automationHold(t.projectPath)
  if (hold) {
    t.queued = true
    t.run = t.run ?? { startedAt: Date.now(), toolCalls: 0, events: [] }
    addEvent(t.run, 'info', `Ready, but waiting in the queue: ${hold}`)
    emit()
    return
  }
  try {
    await startTask(t.id)
  } catch (err) {
    setTaskRun(t.id, { startedAt: Date.now(), finishedAt: Date.now(), toolCalls: 0, events: [], error: (err as Error).message }, 'review')
  }
}

// ---------------------------------------------------------------- stopping

function killTree(child: ChildProcess): void {
  // claude and check commands may start child processes; end the whole tree on Windows.
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill()
  }
}

export function stopTask(id: string): void {
  const child = procs.get(id)
  if (!child) return
  stoppedByUser.add(id)
  killTree(child)
}

export function stopAllTasks(): void {
  for (const id of [...procs.keys()]) stopTask(id)
  for (const id of [...checkProcs.keys()]) stopChecks(id)
}

export function runningTaskCount(): number {
  return procs.size
}
