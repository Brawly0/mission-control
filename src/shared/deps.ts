import type { Task } from './types'

/**
 * Task dependency rules, shared by the main process (auto-start) and the UI (chips, buttons).
 * "Succeeded" means the run finished without an error and its checks, if any ran, passed.
 */

export function isFinished(t: Task): boolean {
  return !!t.run?.finishedAt && (t.column === 'review' || t.column === 'done') && t.run.checks?.status !== 'running'
}

export function taskSucceeded(t: Task): boolean {
  if (!isFinished(t) || t.run!.error) return false
  const checks = t.run!.checks?.status
  return checks === undefined || checks === 'passed'
}

export function taskFailed(t: Task): boolean {
  return isFinished(t) && !taskSucceeded(t)
}

export interface DependencyState {
  /** none: no dependencies; waiting: some haven't finished; blocked: one failed; ready: all succeeded. */
  kind: 'none' | 'waiting' | 'blocked' | 'ready'
  waitingOn: Task[]
  failed: Task[]
}

/** Dependencies that no longer exist (deleted tasks) are ignored. */
export function dependencyState(task: Task, all: Task[]): DependencyState {
  const deps = (task.dependsOn ?? []).map((id) => all.find((t) => t.id === id)).filter((t): t is Task => !!t)
  if (deps.length === 0) return { kind: 'none', waitingOn: [], failed: [] }
  const failed = deps.filter(taskFailed)
  const waitingOn = deps.filter((d) => !taskSucceeded(d) && !taskFailed(d))
  if (failed.length) return { kind: 'blocked', waitingOn, failed }
  if (waitingOn.length) return { kind: 'waiting', waitingOn, failed }
  return { kind: 'ready', waitingOn: [], failed: [] }
}

/** Tasks that list `taskId` as a dependency. */
export function dependentsOf(taskId: string, all: Task[]): Task[] {
  return all.filter((t) => t.dependsOn?.includes(taskId))
}

/** True if making `taskId` depend on `deps` would create a loop (A after B after A). */
export function wouldCreateCycle(taskId: string, deps: string[], all: Task[]): boolean {
  const byId = new Map(all.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const stack = [...deps]
  while (stack.length) {
    const id = stack.pop()!
    if (id === taskId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(byId.get(id)?.dependsOn ?? []))
  }
  return false
}

/** The dependency whose branch a worktree task should start from: the most recently finished one that ran in a worktree. */
export function chainBaseFor(task: Task, all: Task[]): Task | undefined {
  return (task.dependsOn ?? [])
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is Task => !!t?.worktree && taskSucceeded(t))
    .sort((a, b) => (b.run?.finishedAt ?? 0) - (a.run?.finishedAt ?? 0))[0]
}
