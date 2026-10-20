import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { NewTask, QueueStatus, RateLimitInfo, Task, TaskColumn, TaskEvent, TaskRun, WorktreeInfo } from '../shared/types'
import { createWorktree } from './git'
import { agentEnv, whichSync } from './pty'
import { loadStore, updateStore } from './store'

/**
 * The task board's data and the headless runner.
 *
 * Headless tasks run `claude -p --output-format stream-json` as a plain child process (no terminal);
 * the prompt goes in on stdin so no shell quoting is involved. Each stream event updates the task's
 * run (current activity, tool calls, cost), and the board is pushed to the UI.
 */

const MAX_EVENTS = 200

interface Hooks {
  onChange: (tasks: Task[]) => void
  onRateLimit: (info: RateLimitInfo) => void
  onFinished: (task: Task) => void
  onQueueStatus: (status: QueueStatus) => void
}

let tasks: Task[] = []
let hooks: Hooks | null = null
const procs = new Map<string, ChildProcess>()
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
  // Runs can't survive an app restart; say so on the card instead of showing a stale spinner.
  for (const t of tasks) {
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

// ---------------------------------------------------------------- auto-queue

function queuedTasks(): Task[] {
  return tasks.filter((t) => t.column === 'todo' && t.queued && t.mode === 'headless').sort((a, b) => a.order - b.order)
}

export function queueStatus(): QueueStatus {
  const s = loadStore().settings
  const status: QueueStatus = {
    enabled: s.queueEnabled,
    parallel: s.queueParallel,
    queued: queuedTasks().length,
    running: procs.size
  }
  if (!s.queueEnabled) status.heldBecause = 'Auto-run is off'
  else {
    const busiest = Math.max(0, ...(lastRateLimit?.windows.map((w) => w.utilization) ?? []))
    if (s.queuePauseAtPercent > 0 && busiest * 100 >= s.queuePauseAtPercent) {
      status.heldBecause = `Plan usage is at ${Math.round(busiest * 100)}% (limit ${s.queuePauseAtPercent}%)`
    }
  }
  return status
}

let pumping = false

/** Starts queued tasks while there are free slots. */
export async function pumpQueue(): Promise<void> {
  if (pumping || !hooks) return
  pumping = true
  try {
    for (;;) {
      const status = queueStatus()
      hooks.onQueueStatus(status)
      if (status.heldBecause || procs.size >= status.parallel) return
      const next = queuedTasks()[0]
      if (!next) return
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

export function listTasks(): Task[] {
  return tasks
}

export function getRateLimit(): RateLimitInfo | null {
  return lastRateLimit
}

function find(id: string): Task {
  const t = tasks.find((x) => x.id === id)
  if (!t) throw new Error('Task not found')
  return t
}

function nextOrder(column: TaskColumn): number {
  return Math.max(0, ...tasks.filter((t) => t.column === column).map((t) => t.order)) + 1
}

export function createTask(input: NewTask): Task {
  const now = Date.now()
  const task: Task = {
    ...input,
    title: input.title.trim() || input.prompt.trim().split('\n')[0].slice(0, 80) || 'Untitled task',
    id: randomUUID(),
    column: 'todo',
    createdAt: now,
    updatedAt: now,
    order: nextOrder('todo'),
    queued: input.mode === 'headless' && !!input.queued
  }
  tasks = [...tasks, task]
  emit()
  if (task.queued) void pumpQueue()
  return task
}

export function updateTask(id: string, patch: Partial<Task>): void {
  const t = find(id)
  Object.assign(t, patch, { updatedAt: Date.now() })
  // A task that leaves To do also leaves the queue.
  if (t.column !== 'todo') t.queued = false
  tasks = [...tasks]
  emit()
  if ('queued' in patch || 'column' in patch) void pumpQueue()
}

export function deleteTask(id: string): void {
  stopTask(id)
  tasks = tasks.filter((t) => t.id !== id)
  emit()
}

export function setTaskRun(id: string, patch: Partial<TaskRun>, column?: TaskColumn): void {
  const t = find(id)
  t.run = { startedAt: Date.now(), toolCalls: 0, events: [], ...t.run, ...patch }
  if (column && column !== t.column) {
    t.column = column
    t.order = nextOrder(column)
  }
  t.updatedAt = Date.now()
  tasks = [...tasks]
  emit()
}

function addEvent(run: TaskRun, kind: TaskEvent['kind'], text: string): void {
  run.events.push({ at: Date.now(), kind, text: text.slice(0, 4000) })
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS)
}

/** A short, human description of a tool call for the card. */
function describeTool(name: string, input: any): string {
  const file = (p: unknown) => (typeof p === 'string' ? basename(p) : '')
  switch (name) {
    case 'Read':
      return `Reading ${file(input?.file_path)}`
    case 'Write':
      return `Writing ${file(input?.file_path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${file(input?.file_path ?? input?.notebook_path)}`
    case 'Bash':
    case 'PowerShell':
      return `Running: ${String(input?.command ?? '').split('\n')[0].slice(0, 90)}`
    case 'Glob':
    case 'Grep':
      return `Searching ${String(input?.pattern ?? '').slice(0, 60)}`
    case 'WebFetch':
      return `Reading ${String(input?.url ?? '').slice(0, 70)}`
    case 'WebSearch':
      return `Searching the web: ${String(input?.query ?? '').slice(0, 60)}`
    case 'Task':
    case 'Agent':
      return `Delegating: ${String(input?.description ?? '').slice(0, 70)}`
    case 'TodoWrite':
      return 'Updating its plan'
    default:
      return `Using ${name}`
  }
}

function claudeCommand(): { file: string; prefix: string[] } {
  const path = whichSync('claude')
  if (!path) throw new Error('claude was not found on PATH. Install Claude Code first.')
  if (/\.(cmd|bat)$/i.test(path)) return { file: 'cmd.exe', prefix: ['/c', path] }
  return { file: path, prefix: [] }
}

/** Where a task runs: its own new worktree if asked (and none yet), else the project folder. */
async function prepareFolder(t: Task): Promise<{ cwd: string; worktree?: WorktreeInfo }> {
  if (!t.useWorktree) return { cwd: t.projectPath }
  if (t.worktree && existsSync(t.worktree.path)) return { cwd: t.worktree.path, worktree: t.worktree }
  const wt = await createWorktree(t.projectPath)
  t.worktree = wt
  return { cwd: wt.path, worktree: wt }
}

export async function startTask(id: string): Promise<{ interactive?: { cwd: string; args: string[]; worktree?: WorktreeInfo } }> {
  const t = find(id)
  if (procs.has(id)) throw new Error('This task is already running.')
  const { cwd, worktree } = await prepareFolder(t)
  if (worktree) {
    tasks = [...tasks]
    emit()
  }

  if (t.mode === 'interactive') {
    // The UI opens the agent terminal; the prompt is passed as claude's first message.
    const args = [...(t.model ? ['--model', t.model] : []), '--permission-mode', t.permission, t.prompt]
    return { interactive: { cwd, args, worktree } }
  }

  const sessionId = randomUUID()
  const { file, prefix } = claudeCommand()
  const args = [
    ...prefix,
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--session-id',
    sessionId,
    '--permission-mode',
    t.permission,
    ...(t.budgetUsd ? ['--max-budget-usd', String(t.budgetUsd)] : []),
    ...(t.model ? ['--model', t.model] : [])
  ]

  const run: TaskRun = { sessionId, startedAt: Date.now(), toolCalls: 0, events: [], activity: 'Starting…' }
  addEvent(run, 'start', `Started in ${cwd}${worktree ? ` (branch ${worktree.branch})` : ''}`)
  t.run = run
  t.column = 'running'
  t.queued = false
  t.order = nextOrder('running')
  t.updatedAt = Date.now()
  tasks = [...tasks]
  emit()

  const child = spawn(file, args, { cwd, env: agentEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  procs.set(id, child)
  child.stdin.end(t.prompt)

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
      if (handleEvent(t, run, e)) sawResult = true
    }
    t.updatedAt = Date.now()
    tasks = [...tasks]
    emit()
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000)
  })

  const finish = (code: number | null, spawnError?: Error) => {
    if (!procs.has(id)) return
    procs.delete(id)
    run.finishedAt = Date.now()
    if (stoppedByUser.delete(id)) {
      run.error = 'Stopped by you.'
      addEvent(run, 'info', 'Stopped')
    } else if (spawnError) {
      run.error = spawnError.message
    } else if (!sawResult && !run.error) {
      run.error = stderr.trim().split('\n').slice(-3).join('\n') || `claude exited with code ${code}`
    }
    if (run.error) addEvent(run, 'error', run.error)
    run.activity = run.error ? 'Stopped' : 'Finished'
    // Whatever happened, the next step is yours: review the result.
    t.column = 'review'
    t.order = nextOrder('review')
    t.updatedAt = Date.now()
    tasks = [...tasks]
    emit()
    hooks?.onFinished(t)
    // A slot just opened up.
    void pumpQueue()
  }
  child.on('error', (err) => finish(null, err))
  child.on('close', (code) => finish(code))
  return {}
}

/** Applies one stream-json event; returns true for the final result event. */
function handleEvent(t: Task, run: TaskRun, e: any): boolean {
  if (e.type === 'system' && e.subtype === 'init') {
    run.sessionId = e.session_id ?? run.sessionId
    addEvent(run, 'info', `Model ${e.model ?? 'default'}, permission mode ${e.permissionMode ?? t.permission}`)
    run.activity = 'Thinking…'
    return false
  }
  if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
    for (const block of e.message.content) {
      if (block.type === 'tool_use') {
        run.toolCalls++
        run.activity = describeTool(block.name, block.input)
        addEvent(run, 'tool', run.activity)
      } else if (block.type === 'text' && block.text?.trim()) {
        const text = block.text.trim()
        run.activity = text.split('\n')[0].slice(0, 140)
        addEvent(run, 'text', text)
      }
    }
    return false
  }
  if (e.type === 'user' && Array.isArray(e.message?.content)) {
    run.activity = 'Thinking…'
    return false
  }
  if (e.type === 'rate_limit_event' && e.rate_limit_info) {
    const info = e.rate_limit_info
    const windows = Object.entries(info.unifiedWindows ?? {}).map(([name, w]: [string, any]) => ({
      name,
      utilization: Number(w.utilization ?? 0),
      resetsAt: Number(w.resetsAt ?? 0) * 1000
    }))
    lastRateLimit = { at: Date.now(), status: String(info.status ?? ''), windows }
    hooks?.onRateLimit(lastRateLimit)
    hooks?.onQueueStatus(queueStatus())
    return false
  }
  if (e.type === 'result' || 'total_cost_usd' in e) {
    run.costUsd = Number(e.total_cost_usd ?? 0)
    run.turns = Number(e.num_turns ?? 0) || run.turns
    if (e.session_id) run.sessionId = e.session_id
    if (e.is_error || (e.subtype && e.subtype !== 'success')) {
      run.error = typeof e.result === 'string' && e.result ? e.result : `Ended: ${e.subtype ?? 'error'}`
    } else {
      const result = typeof e.result === 'string' ? e.result : ''
      run.result = result
      // The final answer usually just arrived as text; don't list it twice.
      const last = run.events[run.events.length - 1]
      if (last?.kind === 'text' && last.text.trim() === result.trim()) last.kind = 'result'
      else addEvent(run, 'result', result || 'Done')
    }
    return true
  }
  return false
}

export function stopTask(id: string): void {
  const child = procs.get(id)
  if (!child) return
  stoppedByUser.add(id)
  // claude may run child processes (shells, tools); end the whole tree on Windows.
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill()
  }
}

export function stopAllTasks(): void {
  for (const id of [...procs.keys()]) stopTask(id)
}

export function runningTaskCount(): number {
  return procs.size
}
