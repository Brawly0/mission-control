import { briefingContext } from './projectBriefing'
import { codexUsage } from './codexData'
import { codexTaskArgs, applyCodexTaskEvent } from '../shared/codexTask'
import { spawn, type ChildProcess } from 'node:child_process'
import { terminateProcessTreesSync } from './processCleanup'
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
import { formatClaudeEvent, formatCodexEvent, formatEvents, formatNote, formatStart } from '../shared/taskConsole'
import { defaultModelFor, launchArgs } from './spend'
import { markEcoSession } from './planCost'
import { assignmentsOverlap, parseTeamPlan, teamPlannerPrompt } from '../shared/teamPlan'

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
  /** Terminal text from a background run, for the live task terminals. */
  onOutput?: (id: string, chunk: string) => void
}

let tasks: Task[] = []
let hooks: Hooks | null = null
const procs = new Map<string, ChildProcess>()
const checkProcs = new Map<string, ChildProcess>()
const stoppedByUser = new Set<string>()
const startingTasks = new Set<string>()
const finalizingTasks = new Set<string>()
let shuttingDown = false
let queueTimer: ReturnType<typeof setInterval> | undefined
let queueStart: ReturnType<typeof setTimeout> | undefined
const teamOperations = new Set<string>()
let lastRateLimit: RateLimitInfo | null = null

/** Live terminal text of each background run in this app session (capped; not saved). */
const outputs = new Map<string, string>()
const OUTPUT_CHARS = 400_000

function appendOutput(id: string, chunk: string): void {
  if (!chunk) return
  const next = (outputs.get(id) ?? '') + chunk
  // Trim from a line start so a cut never lands inside an escape sequence.
  const cut = next.length > OUTPUT_CHARS ? next.indexOf('\n', next.length - OUTPUT_CHARS) + 1 : 0
  outputs.set(id, cut > 0 ? next.slice(cut) : next)
  hooks?.onOutput?.(id, chunk)
}

/** A task's terminal text so far; runs from before this app session are rebuilt from their saved events. */
export function getTaskOutput(id: string): string {
  return outputs.get(id) ?? formatEvents(tasks.find((t) => t.id === id)?.run?.events ?? [])
}

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
  shuttingDown = false
  hooks = h
  tasks = loadStore().tasks
  // Runs and checks can't survive an app restart; say so on the card instead of showing a stale spinner.
  for (const t of tasks) {
    if (t.team?.phase === 'running' || t.team?.phase === 'planning') {
      t.team.phase = t.team.phase === 'planning' ? 'error' : 'paused'
      t.team.error = 'Mission Control closed. Resume the team or retry planning to continue.'
    }
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
  clearInterval(queueTimer); clearTimeout(queueStart)
  queueTimer = setInterval(() => { void pumpQueue(); void pumpTeams() }, 30_000)
  queueStart = setTimeout(pumpQueue, 3000)
}

// ---------------------------------------------------------------- guardrails

function busiestPlanPercent(): number {
  return Math.round(Math.max(0, ...(lastRateLimit?.windows.map((w) => w.utilization) ?? [])) * 100)
}

/** Why automation shouldn't start a task in this project right now, or null if it may. */
export async function automationHold(projectPath: string, tool: 'claude' | 'codex' = 'claude'): Promise<string | null> {
  const s = loadStore().settings
  const plan = tool === 'codex' ? Math.round(Math.max(0, ...((await codexUsage(0)).limits?.windows.map(w => w.utilization) ?? [])) * 100) : busiestPlanPercent()
  if (s.queuePauseAtPercent > 0 && plan >= s.queuePauseAtPercent) return `Plan usage is at ${plan}% (limit ${s.queuePauseAtPercent}%)`
  const budget = await projectBudget(projectPath)
  if (budget?.over) return `Project is over its monthly budget ($${budget.spent.toFixed(2)} of $${budget.budget})`
  return null
}

// ---------------------------------------------------------------- auto-queue

function queuedTasks(): Task[] {
  return tasks.filter((t) => !t.team && !t.teamParentId && t.column === 'todo' && t.queued && t.mode === 'headless' && dependencyState(t, tasks).kind !== 'waiting' && dependencyState(t, tasks).kind !== 'blocked').sort((a, b) => a.order - b.order)
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
    if (!queuedTasks().some(t => t.tool === 'codex') && s.queuePauseAtPercent > 0 && plan >= s.queuePauseAtPercent) status.heldBecause = `Plan usage is at ${plan}% (limit ${s.queuePauseAtPercent}%)`
  }
  return status
}

let pumping = false

/** Starts queued tasks while there are free slots. Tasks of projects over budget wait. */
export async function pumpQueue(): Promise<void> {
  if (shuttingDown || pumping || !hooks) return
  pumping = true
  try {
    const skipped = new Set<string>()
    for (;;) {
      if (shuttingDown) return
      const status = queueStatus()
      hooks.onQueueStatus(status)
      if (status.heldBecause || procs.size >= status.parallel) return
      const next = queuedTasks().find((t) => !skipped.has(t.id))
      if (!next) return
      const hold = await automationHold(next.projectPath, next.tool)
      if (shuttingDown) return
      if (teamOperations.has(next.id) || next.team || startingTasks.has(next.id) || !next.queued || next.column !== 'todo') continue
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
    model: input.tool === 'codex' ? input.model || undefined : input.model || defaultModelFor(input.projectPath, true),
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

/** Uses the selected CLI's normal tracked, cancellable runner in read-only mode. */
export async function planTaskTeam(id: string): Promise<void> {
  const t = find(id)
  if (shuttingDown) throw new Error('Mission Control is closing.')
  if (t.teamParentId || t.column !== 'todo' || t.run || t.team?.memberIds.length || t.team?.phase === 'planning' || startingTasks.has(id)) throw new Error('Split an unstarted To do task into agents.')
  if (teamOperations.has(id)) throw new Error('The team is already being prepared.')
  if (tasks.some(member => member.teamParentId === id && memberActive(member.id))) throw new Error('Wait for the previous planner to stop.')
  taskCommand(t.tool ?? 'claude')
  if (t.tool === 'codex' && t.budgetUsd) throw new Error('Codex does not support a USD cap.')
  t.queued = false; emit()
  teamOperations.add(id)
  try {
    if (!(await gitInfo(t.projectPath)).isRepo) throw new Error('Agent teams need a git repository for their isolated worktree.')
    if (shuttingDown) throw new Error('Mission Control is closing.')
    if (t.column !== 'todo' || t.run) throw new Error('The task changed while team planning was being prepared.')
  } finally { teamOperations.delete(id) }
  const budgetUsd = t.tool === 'codex' ? undefined : t.team ? t.team.budgetUsd : (t.budgetUsd || loadStore().settings.defaultTaskBudgetUsd || undefined)
  const available = budgetUsd === undefined ? undefined : budgetUsd - teamCost(t)
  if (available !== undefined && available <= 0.001) throw new Error('The team’s USD cap is exhausted. Increase the cap before retrying.')
  const planner = createTask({ tool: t.tool, title: `Plan team: ${t.title}`, prompt: teamPlannerPrompt(t), projectPath: t.projectPath, projectName: t.projectName, mode: 'headless', permission: 'plan', useWorktree: false, model: t.model, budgetUsd: available })
  planner.teamParentId = t.id
  planner.teamRole = 'planner'
  t.queued = false
  t.team = { phase: 'planning', plannerId: planner.id, memberIds: [], budgetUsd }
  emit()
  try { await startTask(planner.id, true) }
  catch (err) {
    planner.run = { startedAt: Date.now(), finishedAt: Date.now(), events: [], toolCalls: 0, error: (err as Error).message }
    moveTo(planner, 'review')
    t.team.phase = 'error'; t.team.error = (err as Error).message
    emit()
    throw err
  }
}

function teamMembers(t: Task): Task[] {
  return (t.team?.memberIds ?? []).map(id => tasks.find(member => member.id === id)).filter((member): member is Task => !!member)
}

function memberActive(id: string): boolean {
  return procs.has(id) || checkProcs.has(id) || startingTasks.has(id) || finalizingTasks.has(id)
}

function teamCost(t: Task): number {
  return tasks.filter(member => member.teamParentId === t.id).reduce((sum, member) => sum + (member.teamSpentUsd ?? 0) + (member.run?.costUsd ?? 0), 0)
}

/** All UI entry points must leave the shared checkout intact until integration finishes. */
export function assertTeamWorktreeIdle(path: string): void {
  const target = normalizePath(path).replace(/\\+$/, '')
  const team = tasks.find(t => t.team && t.worktree && (target === normalizePath(t.worktree.path) || target.startsWith(normalizePath(t.worktree.path) + '\\')))
  if (team?.team?.phase !== undefined && (team.team.phase !== 'review' || teamMembers(team).some(member => memberActive(member.id)))) throw new Error('Finish the agent team before committing, merging, or discarding its shared worktree. To abandon it, pause and delete the original task first.')
}

function updateTeamProgress(t: Task): void {
  if (!t.team || !t.run) return
  const members = teamMembers(t)
  const planner = tasks.find(member => member.id === t.team!.plannerId)
  const runs = [planner, ...members].flatMap(member => member?.run ? [member.run] : [])
  t.run.costUsd = teamCost(t) || undefined
  t.run.toolCalls = runs.reduce((sum, run) => sum + run.toolCalls, 0)
  t.run.activity = `${members.filter(taskSucceeded).length}/${members.length} assignments complete`
  t.updatedAt = Date.now()
}

/** Build all assignments before scheduling; workers share one isolated checkout, without individual commits. */
export async function startTaskTeam(id: string): Promise<void> {
  const t = find(id), team = t.team
  if (shuttingDown) throw new Error('Mission Control is closing.')
  if (!team?.plan || !['ready', 'paused', 'error'].includes(team.phase)) throw new Error('Wait for a team plan before starting.')
  team.plan = parseTeamPlan(JSON.stringify(team.plan))
  if (teamOperations.has(id) || teamMembers(t).some(member => memberActive(member.id))) throw new Error('Wait for the team to finish starting or stopping.')
  const deps = dependencyState(t, tasks)
  if (deps.kind === 'blocked' || deps.kind === 'waiting') throw new Error('Finish the tasks this team depends on first.')
  taskCommand(t.tool ?? 'claude')
  teamOperations.add(id)
  team.phase = 'running'; team.error = undefined; team.holdReason = undefined
  t.run = { ...t.run, startedAt: t.run?.startedAt ?? Date.now(), finishedAt: undefined, error: undefined, toolCalls: t.run?.toolCalls ?? 0, events: t.run?.events ?? [], activity: 'Preparing the team worktree…' }
  t.mode = 'headless'
  moveTo(t, 'running'); emit()
  try {
    if (t.worktree && !existsSync(t.worktree.path)) throw new Error('The team worktree was removed. Its assignments cannot safely resume.')
    if (!t.worktree) {
      t.useWorktree = true
      await prepareFolder(t)
    }
    if (shuttingDown || t.team?.phase !== 'running') return
    if (!team.memberIds.length) {
      const byStep = new Map<string, string>()
      const makeMember = (title: string, prompt: string, role: 'worker' | 'integrator') => {
        const member = createTask({ title, prompt, tool: t.tool, projectPath: t.projectPath, projectName: t.projectName, mode: 'headless', permission: t.permission, useWorktree: false, model: t.model, budgetUsd: t.budgetUsd })
        member.teamParentId = t.id; member.teamRole = role; member.whenReady = 'none'
        team.memberIds.push(member.id)
        return member
      }
      for (const assignment of team.plan.agents) {
        const member = makeMember(assignment.title, `You are one worker on a coordinated agent team.\nOverall task:\n${t.prompt}\n\nYour assignment:\n${assignment.prompt}\n\nYou own only these paths relative to this checkout:\n${assignment.files.join('\n')}\nOther agents may be editing other files concurrently. Do not change files outside your ownership, revert others' changes, commit, merge, create branches, or launch other agents. If the scope is insufficient, stop and explain the blocker. Run focused tests relevant to your assignment. Finish with a concise handoff: files changed, interfaces, tests, and unresolved issues.`, 'worker')
        member.teamStepId = assignment.id
        member.dependsOn = assignment.dependsOn.map(step => byStep.get(step)!)
        byStep.set(assignment.id, member.id)
      }
      const integrator = makeMember(`Integrate and verify: ${t.title}`, `You are the final integration agent. All workers have finished in this same checkout.\nOriginal task:\n${t.prompt}\n\nInspect their combined changes, resolve integration problems, and verify every acceptance condition. Run appropriate tests. Finish with a concise summary and remaining limitations. Do not commit, merge, publish, change versions, or launch other agents; Mission Control commits the isolated branch and runs the configured project checks after you finish.`, 'integrator')
      integrator.dependsOn = [...byStep.values()]
    } else {
      // Keep successful work. Interrupted/failed assignments restart from their saved prompt.
      for (const member of teamMembers(t)) if (!taskSucceeded(member)) { member.teamSpentUsd = (member.teamSpentUsd ?? 0) + (member.run?.costUsd ?? 0); member.run = undefined; moveTo(member, 'todo') }
    }
    const completedIntegrator = teamMembers(t).find(member => member.teamRole === 'integrator' && taskSucceeded(member))
    if (completedIntegrator) settleTeamMember(completedIntegrator)
    updateTeamProgress(t); emit()
  } catch (err) {
    team.phase = 'error'; team.error = (err as Error).message
    t.run.error = team.error; t.run.finishedAt = Date.now(); moveTo(t, 'review'); emit()
    throw err
  } finally { teamOperations.delete(id) }
  await pumpTeams()
}

export function stopTaskTeam(id: string): void {
  const t = find(id), team = t.team
  if (!team || !['planning', 'running', 'paused'].includes(team.phase)) return
  const planning = team.phase === 'planning'
  team.phase = planning ? 'error' : 'paused'
  team.error = planning ? 'Planning stopped. Retry when you are ready.' : 'Team paused. Completed assignments are kept.'
  team.holdReason = undefined
  for (const memberId of [team.plannerId, ...team.memberIds]) { stopTask(memberId); stopChecks(memberId) }
  if (t.run) { t.run.error = team.error; t.run.finishedAt = Date.now(); moveTo(t, 'review') }
  emit()
}

let pumpingTeams = false
async function pumpTeams(): Promise<void> {
  if (pumpingTeams || shuttingDown) return
  pumpingTeams = true
  try {
    for (const t of tasks.filter(t => t.team?.phase === 'running')) {
      const team = t.team!
      if (teamOperations.has(t.id)) continue
      try { team.holdReason = await automationHold(t.projectPath, t.tool) ?? undefined }
      catch (err) { team.holdReason = `Could not check team limits: ${(err as Error).message}. Retrying shortly.`; continue }
      if (shuttingDown || team.phase !== 'running' || team.holdReason) continue
      const members = teamMembers(t)
      for (const member of members) {
        if (shuttingDown || team.phase !== 'running') break
        if (member.column !== 'todo' || startingTasks.has(member.id)) continue
        const deps = dependencyState(member, tasks)
        if (deps.kind === 'blocked' || deps.kind === 'waiting') continue
        if (runningTaskCount() >= 3) { team.holdReason = 'Waiting for a free agent slot (up to 3 run at once).'; break }
        const assignment = team.plan!.agents.find(a => a.id === member.teamStepId)
        const conflicts = assignment && members.some(other => {
          if (!procs.has(other.id) && !startingTasks.has(other.id)) return false
          const scope = team.plan!.agents.find(a => a.id === other.teamStepId)
          return !!scope && assignmentsOverlap(assignment, scope)
        })
        if (conflicts) continue
        if (team.budgetUsd !== undefined) {
          const reserved = members.filter(m => memberActive(m.id)).reduce((sum, m) => sum + Math.max(0, (m.budgetUsd ?? 0) - (m.run?.costUsd ?? 0)), 0)
          const available = team.budgetUsd - teamCost(t) - reserved
          if (available <= 0.001) {
            team.phase = 'paused'; team.error = 'The team’s USD cap is exhausted. Increase the cap, then resume.'
            if (t.run) { t.run.error = team.error; t.run.finishedAt = Date.now(); moveTo(t, 'review') }
            break
          }
          member.budgetUsd = available / members.filter(m => m.column === 'todo').length
        } else member.budgetUsd = undefined
        try { await startTask(member.id, true) }
        catch (err) {
          member.run = { startedAt: Date.now(), finishedAt: Date.now(), events: [], toolCalls: 0, error: (err as Error).message }
          moveTo(member, 'review'); settleTeamMember(member)
        }
      }
      updateTeamProgress(t)
    }
    emit()
  } finally { pumpingTeams = false }
}

function settleTeamMember(member: Task): void {
  const t = tasks.find(t => t.id === member.teamParentId)
  if (!t?.team) return
  const team = t.team
  if (member.teamRole === 'planner') {
    if (team.plannerId !== member.id || team.phase !== 'planning') return
    try {
      if (member.run?.error) throw new Error(member.run.error)
      team.plan = parseTeamPlan(member.run?.result ?? '')
      team.phase = 'ready'; team.error = undefined
    } catch (err) { team.phase = 'error'; team.error = `Could not create the team plan: ${(err as Error).message}` }
  } else {
    updateTeamProgress(t)
    if (team.phase === 'running' && !taskSucceeded(member)) {
      team.phase = 'paused'
      team.error = `${member.title} needs attention. Open its result, then resume to retry.`
      for (const peer of teamMembers(t)) if (peer.id !== member.id) { stopTask(peer.id); stopChecks(peer.id) }
    }
    if (member.teamRole === 'integrator' && team.phase === 'running' && taskSucceeded(member)) {
      team.phase = 'review'
      t.run = { ...t.run!, finishedAt: Date.now(), checks: member.run?.checks, commit: member.run?.commit, result: member.run?.result, activity: 'Team finished. Review the combined changes.' }
      moveTo(t, 'review'); hooks?.onFinished(t); onTaskSettled(t)
    } else if (team.phase === 'paused' && !teamMembers(t).some(m => memberActive(m.id))) {
      t.run!.error = team.error; t.run!.finishedAt = Date.now(); moveTo(t, 'review')
    }
  }
  emit()
}

export function updateTask(id: string, patch: Partial<Task>): void {
  const t = find(id)
  if (t.teamParentId) throw new Error('Team assignments are managed from the original task.')
  if (t.team) {
    const budgetChange = Object.keys(patch).length === 1 && 'budgetUsd' in patch && t.tool !== 'codex' && !['running', 'planning'].includes(t.team.phase)
    if (budgetChange) {
      if (patch.budgetUsd !== undefined && (!Number.isFinite(patch.budgetUsd) || patch.budgetUsd <= teamCost(t))) throw new Error('The team cap must be greater than its reported spend.')
      t.team.budgetUsd = patch.budgetUsd
    } else if (Object.keys(patch).some(key => key !== 'column' && key !== 'order') || patch.column && (patch.column !== 'done' || t.team.phase !== 'review')) throw new Error('Use the team controls to manage this task.')
  }
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
  const t = find(id)
  if (teamOperations.has(id)) throw new Error('Wait for the team to finish preparing.')
  if (t.teamParentId) throw new Error('Delete the original task to remove its team.')
  if (t.team && (teamOperations.has(id) || tasks.some(member => member.teamParentId === id && memberActive(member.id)))) throw new Error('Pause the team and wait for its agents to stop before deleting it.')
  if (t.team) tasks = tasks.filter(member => member.teamParentId !== id)
  stopTask(id)
  stopChecks(id)
  tasks = tasks.filter((t) => t.id !== id)
  outputs.delete(id)
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
  if (t.team || t.teamParentId) throw new Error('Team runs are managed from the original task.')
  t.run = { startedAt: Date.now(), toolCalls: 0, events: [], ...t.run, ...patch }
  if (column) moveTo(t, column)
  t.updatedAt = Date.now()
  emit()
  // An interactive task finishing can unblock others.
  if (column === 'review' || column === 'done') onTaskSettled(t)
}

// ---------------------------------------------------------------- running

export function claudeCommand(): { file: string; prefix: string[] } { return taskCommand('claude') }
function taskCommand(tool: 'claude' | 'codex') {
  const path = whichSync(tool)
  if (!path) throw new Error(tool + ' was not found on PATH. Install the CLI first.')
  if (/\.(cmd|bat)$/i.test(path)) return { file: 'cmd.exe', prefix: ['/c', path] }
  return { file: path, prefix: [] }
}

/**
 * Where a task runs: its existing worktree, a new one (starting from the branch of the task it waited on,
 * so it builds on that work), or the project folder.
 */
async function prepareFolder(t: Task): Promise<{ cwd: string; worktree?: WorktreeInfo }> {
  if (t.teamParentId) {
    const parent = find(t.teamParentId)
    if (t.teamRole === 'planner') return { cwd: parent.projectPath }
    if (!parent.worktree || !existsSync(parent.worktree.path)) throw new Error('The team worktree is missing.')
    return { cwd: parent.worktree.path }
  }
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

export async function startTask(id: string, teamManaged = false): Promise<{ interactive?: { cwd: string; args: string[]; worktree?: WorktreeInfo } }> {
  if (shuttingDown) throw new Error('Mission Control is closing.')
  if (startingTasks.has(id)) throw new Error('This task is already starting.')
  startingTasks.add(id)
  try {
    const t = find(id)
    if (teamOperations.has(id)) throw new Error('The team is being prepared.')
    if (t.team || t.teamParentId && !teamManaged) throw new Error('Use the original task’s team controls to start its agents.')
    if (procs.has(id) || t.column === 'running') throw new Error('This task is already running.')
    taskCommand(t.tool ?? 'claude')
    if (t.tool === 'codex' && t.budgetUsd) throw new Error('Codex does not support a per-task USD cap. Remove the cap before starting.')
    const { cwd, worktree } = await prepareFolder(t)
    if (shuttingDown) throw new Error('Mission Control is closing.')
    if (t.teamParentId && find(t.teamParentId).team?.phase !== (t.teamRole === 'planner' ? 'planning' : 'running')) throw new Error('The team was paused.')
    if (worktree) emit()

    if (t.mode === 'interactive') {
      // The UI opens the agent terminal; the prompt is passed as claude's first message.
      const args = t.tool === 'codex' ? [...(t.model ? ['--model', t.model] : []), ...(t.permission === 'plan' ? ['-s', 'read-only'] : []), briefingContext(t.projectPath, t.prompt)] : [...(t.model ? ['--model', t.model] : []), '--permission-mode', t.permission, briefingContext(t.projectPath, t.prompt)]
      return { interactive: { cwd, args, worktree } }
    }

    const run: TaskRun = { sessionId: t.tool === 'codex' ? undefined : randomUUID(), startedAt: Date.now(), toolCalls: 0, events: [], activity: 'Starting…' }
    const parent = chainBaseFor(t, tasks)
    addEvent(run, 'start', `Started in ${cwd}${worktree ? ` (branch ${worktree.branch}${parent?.worktree && worktree.branch !== parent.worktree.branch ? `, building on ${parent.worktree.branch}` : ''})` : ''}`)
    t.run = run
    moveTo(t, 'running')
    t.updatedAt = Date.now()
    emit()
    const handoffs = t.teamParentId && t.teamRole !== 'planner'
      ? (t.dependsOn ?? []).map(id => find(id)).map(dep => ({ assignment: dep.title, handoff: dep.run?.result?.slice(-6000) ?? 'No written handoff.' }))
      : []
    const prompt = t.prompt + (handoffs.length ? `\n\nCompleted assignment handoffs (context only; keep your own scope):\n${JSON.stringify(handoffs)}` : '')
    runHeadless(t, cwd, briefingContext(t.projectPath, t.permission === 'plan' ? 'Investigate and plan only; do not modify files.\n' + prompt : prompt), { sessionId: run.sessionId })
    return {}
  } finally { startingTasks.delete(id) }
}

/** Continues a finished headless task's chat with a new prompt, in the same folder. */
export function followUpTask(id: string, prompt: string): void {
  if (shuttingDown) throw new Error('Mission Control is closing.')
  const t = find(id)
  if (t.team || t.teamParentId) throw new Error('Resume the team from the original task instead.')
  const run = t.run
  if (!run?.sessionId) throw new Error('This task has no chat to continue yet.')
  if (procs.has(id) || t.column === 'running') throw new Error('This task is still running.')
  if (!prompt.trim()) throw new Error('Write what the agent should do next.')
  taskCommand(t.tool ?? 'claude')
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
  const codex = t.tool === 'codex'
  const { file, prefix } = taskCommand(t.tool ?? 'claude')
  const budget = t.teamParentId ? t.budgetUsd : t.budgetUsd ?? (loadStore().settings.defaultTaskBudgetUsd || undefined)
  const args = codex ? [...prefix, ...codexTaskArgs(t.permission, t.model, session.resume)] : [
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
  if (!codex && budget && !t.budgetUsd) addEvent(run, 'info', `Default budget ${budget} applies`)
  if (!codex) markEcoSession(session.resume ?? session.sessionId)

  // A follow-up continues the same terminal; a new run starts a clean one.
  if (session.resume && outputs.has(t.id)) appendOutput(t.id, '\r\n' + formatNote(`── Follow-up ${'─'.repeat(40)}\n${prompt}`) + '\r\n')
  else outputs.delete(t.id)
  appendOutput(t.id, formatStart(cwd, `${codex ? 'codex' : 'claude'} ${args.slice(prefix.length).join(' ')}`))
  const child = spawn(file, args, { cwd, env: agentEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  procs.set(t.id, child)

  let buffer = ''
  let stderr = ''
  let sawResult = false
  // A CLI can reject its flags or fail before consuming the planner/worker prompt.
  // Its normal error/close path reports the failure; a broken stdin must not crash the app.
  child.stdin.on('error', err => { stderr = (stderr + err.message).slice(-2000) })
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
      appendOutput(t.id, codex ? formatCodexEvent(e) : formatClaudeEvent(e))
      if (codex) { if (applyCodexTaskEvent(run, e, (kind, text) => addEvent(run, kind, text))) sawResult = true; continue }
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
    appendOutput(t.id, formatNote(chunk, 'error'))
  })

  const finish = async (code: number | null, spawnError?: Error) => {
    if (!procs.has(t.id)) return
    procs.delete(t.id)
    finalizingTasks.add(t.id)
    if (stoppedByUser.delete(t.id)) {
      run.error = 'Stopped by you.'
      addEvent(run, 'info', 'Stopped')
    } else if (spawnError) {
      run.error = spawnError.message
    } else if ((!sawResult || code !== 0) && !run.error) {
      run.error = stderr.trim().split('\n').slice(-3).join('\n') || `${t.tool ?? 'claude'} exited with code ${code}`
    }
    if (run.error) addEvent(run, 'error', run.error)
    run.activity = run.error ? 'Stopped' : 'Finished'
    appendOutput(t.id, '\r\n' + formatNote(run.error ? `[${run.error.split('\n')[0]}]` : `[process exited with code ${code ?? 0}]`, run.error ? 'error' : 'dim'))

    if (!run.error) {
      try { await afterSuccess(t, cwd) }
      catch (err) { run.error = `Could not finish the task: ${(err as Error).message}`; addEvent(run, 'error', run.error) }
    }
    run.finishedAt = Date.now()
    // Whatever happened, the next step is yours: review the result.
    moveTo(t, 'review')
    t.updatedAt = Date.now()
    emit()
    invalidateBudgets()
    finalizingTasks.delete(t.id)
    if (t.teamParentId) settleTeamMember(t)
    else { hooks?.onFinished(t); onTaskSettled(t) }
    // A slot just opened up.
    void pumpQueue()
    void pumpTeams()
  }
  child.on('error', (err) => void finish(null, err))
  child.on('close', (code) => void finish(code))
  child.stdin.end(prompt)
}

/** Commit the worktree's changes, then run the project's checks. */
async function afterSuccess(t: Task, cwd: string): Promise<void> {
  const run = t.run!
  // A planner must remain read-only. Workers may still be editing the shared checkout;
  // only the final integration stage can commit the combined work and run project checks.
  if (t.teamRole === 'planner' || t.teamRole === 'worker') return
  if (t.teamRole === 'integrator') {
    if (t.permission === 'plan') return
    const parent = find(t.teamParentId!)
    if (shuttingDown || parent.team?.phase !== 'running') throw new Error('Team paused before final checks.')
    await runChecks(t, cwd)
    if (run.checks && run.checks.status !== 'passed') return
    if (shuttingDown || parent.team?.phase !== 'running') throw new Error('Team paused before committing.')
    const hash = await commitIfDirty(cwd, `${parent.title}\n\nCompleted by a Mission Control agent team.`)
    if (hash) { run.commit = hash; addEvent(run, 'info', `Committed combined changes as ${hash}`) }
    return
  }
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
  if (shuttingDown) {
    run.checks = { command, status: 'error', output: 'Checks not started because Mission Control is closing.', startedAt: Date.now(), finishedAt: Date.now() }
    return
  }
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
  if (shuttingDown) throw new Error('Mission Control is closing.')
  if (checkProcs.has(id)) throw new Error('Checks are already running for this task.')
  const t = find(id)
  if (t.team || t.teamParentId) throw new Error('Resume the team to retry integration and its checks.')
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
  if (t.team || t.teamParentId) return
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
  const hold = await automationHold(t.projectPath, t.tool)
  if (t.team || t.teamParentId || teamOperations.has(t.id) || startingTasks.has(t.id) || t.column !== 'todo') return
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
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
  } else {
    child.kill()
  }
}

export function stopTask(id: string): void {
  if (tasks.find(t => t.id === id)?.team) return stopTaskTeam(id)
  const child = procs.get(id)
  if (!child) return
  stoppedByUser.add(id)
  killTree(child)
}

export function stopAllTasks(): void {
  shuttingDown = true
  clearInterval(queueTimer); clearTimeout(queueStart)
  const children = [...procs.values(), ...checkProcs.values()]
  for (const id of procs.keys()) stoppedByUser.add(id)
  terminateProcessTreesSync(children.flatMap(child => child.pid ? [child.pid] : []))
}

export function runningTaskCount(): number {
  return new Set([...procs.keys(), ...checkProcs.keys(), ...startingTasks, ...finalizingTasks, ...teamOperations]).size
}
