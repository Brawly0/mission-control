import type { NewTask, Task } from '@shared/types'
import { dependencyState } from '@shared/deps'

export const STARTER_TASK: Partial<NewTask> = {
  title: 'Understand this project',
  prompt: 'Inspect this project without changing files or running commands. Explain its purpose, main entry points, and documented run/test commands. Suggest one small improvement and explain how I could verify it.',
  permission: 'plan', mode: 'headless'
}

/** Record only after the corresponding result/diff was actually displayed. Never on guide navigation. */
export interface TaskInspection {
  taskId: string
  runStartedAt: number
  runFinishedAt: number
  result: boolean
  changes: boolean
  /** Fingerprint of the actual diff displayed, supplied by the review surface. */
  changesFingerprint?: string
}
export interface FirstTaskInput {
  projectPath?: string
  /** Explicitly bind after creation or user selection. Never infer the latest task. */
  taskId?: string
  tasks: Task[]
  inspection?: TaskInspection
  /** Current diff fingerprint for this task's review surface; omit while unavailable. */
  reviewFingerprint?: string
}

/** Merge observations only within the same completed run. A fresh review snapshot
 * replaces change evidence; displaying the result must not erase that evidence. */
export function recordTaskInspection(previous: TaskInspection | undefined, next: TaskInspection, source: 'result' | 'changes'): TaskInspection {
  const sameRun = previous?.taskId === next.taskId && previous.runStartedAt === next.runStartedAt && previous.runFinishedAt === next.runFinishedAt
  if (!sameRun) return next
  return source === 'result' ? { ...previous, result: next.result } : { ...next, result: previous.result }
}
export type GuidanceStep = 'project' | 'create' | 'choices' | 'start' | 'progress' | 'recover' | 'review' | 'complete'
export interface FirstTaskProgress { step: GuidanceStep; task?: Task; message: string }

export function firstTaskProgress(input: FirstTaskInput): FirstTaskProgress {
  if (!input.projectPath) return { step: 'project', message: 'Open a project folder to give the agent a workspace.' }
  const task = input.tasks.find(t => t.id === input.taskId && t.projectPath === input.projectPath && !t.teamParentId)
  if (!task) return { step: 'create', message: 'Create a task with a clear goal. The starter prompt is editable and is only added when you choose.' }
  const at = (step: GuidanceStep, message: string): FirstTaskProgress => ({ step, task, message })
  if (!task.permission || typeof task.useWorktree !== 'boolean') return at('choices', 'Review permissions and worktree isolation before starting.')
  const run = task.run
  if (task.team && task.team.phase !== 'review') return at(task.team.phase === 'error' || task.team.phase === 'paused' ? 'recover' : task.team.phase === 'ready' ? 'start' : 'progress', 'Open the team plan and member activity. Combined changes are available after integration.')
  if (!run) {
    const deps = dependencyState(task, input.tasks)
    return at('start', deps.kind === 'blocked' || deps.kind === 'waiting' ? 'This task waits for dependencies. Open the preceding tasks to inspect their progress or failures.' : task.queued ? 'The task is queued. It starts when a queue slot is available.' : 'Review the saved permissions and isolation, then start when ready.')
  }
  if (task.column === 'running') return at('progress', 'Follow real activity in the task drawer. Background tasks cannot answer interactive approval prompts.')
  if (!run.finishedAt || run.error) return at('recover', 'The run failed or was interrupted. Inspect the task before choosing whether to run again.')
  if (run.checks?.status === 'running') return at('progress', 'Project checks are still running. A pending check has not passed.')
  if (run.checks && (run.checks.status !== 'passed' || !run.checks.finishedAt || run.checks.startedAt < run.startedAt)) return at('recover', 'Project checks failed or could not be verified. Inspect the checks before retrying.')
  if (task.column !== 'review' && task.column !== 'done') return at('recover', 'The run has no confirmed review state. Open the task to inspect it.')
  const seen = input.inspection
  const inspected = seen?.taskId === task.id && seen.runStartedAt === run.startedAt && seen.runFinishedAt === run.finishedAt && seen.result && (!!run.result || task.mode === 'interactive') && (!task.worktree || (seen.changes && !!input.reviewFingerprint && seen.changesFingerprint === input.reviewFingerprint))
  if (!inspected) return at('review', `${run.checks ? 'Inspect the result and check outcome.' : 'No checks ran; inspect the result and decide what verification is needed.'}${task.worktree ? ' Open Changes, inspect the diff, and confirm "Reviewed this diff and results".' : ' Review any files changed directly in the project.'} Inspecting does not mark done or merge.`)
  return at('complete', 'You inspected this run and its available changes. Mark done and merge remain separate decisions; existing review safeguards still apply.')
}
