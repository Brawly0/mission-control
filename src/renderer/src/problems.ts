import type { ProjectReview, Task } from '@shared/types'
import type { ReadinessCheck, ReadinessResult } from '@shared/readiness'

export type DiagnosticScope = { kind: 'connections' } | { kind: 'project'; projectPath: string }
export type ProblemAction =
  | { kind: 'recheck'; scope: DiagnosticScope }
  | { kind: 'setup'; scope: DiagnosticScope; checkId: string }
  | { kind: 'open-project'; projectPath: string }
  | { kind: 'open-task' | 'retry-task' | 'retry-checks'; taskId: string }
export interface Problem {
  id: string
  title: string
  effect: string
  next: string
  action: ProblemAction
  /** Secondary retry actions remain explicit user choices, never automatic. */
  secondary?: ProblemAction
}
export interface ProblemRecord { version: number; problem?: Problem }
/** Includes resolved tombstones so late snapshots cannot resurrect an old failure. */
export type ProblemState = Record<string, ProblemRecord>
export interface DiagnosticSnapshot {
  scope: DiagnosticScope
  latestRequestId: string
  result?: ReadinessResult
}
export interface ProblemsInput {
  diagnostics?: DiagnosticSnapshot[]
  tasks?: Task[]
  reviews?: ProjectReview[]
}

function diagnosticCopy(check: ReadinessCheck): Pick<Problem, 'title' | 'effect' | 'next'> {
  // Never surface diagnostic output, task errors, prompts, credentials, or manifest content.
  switch (check.reason) {
    case 'tool_missing': return { title: 'A required CLI is missing', effect: 'Tasks needing this tool cannot start.', next: 'Open setup to install the tool, then recheck.' }
    case 'signed_out': return { title: 'An agent is signed out', effect: 'Tasks for this agent cannot authenticate.', next: 'Open setup, sign in through the CLI, then recheck.' }
    case 'not_repository': case 'history_missing': return { title: 'Git workspace requirements are missing', effect: 'Worktree isolation and agent teams are unavailable.', next: 'Review Git setup in the project. Initialize or commit only when you choose, then recheck.' }
    case 'folder_missing': case 'folder_inaccessible': return { title: 'The project folder is unavailable', effect: 'The app cannot verify or use this folder.', next: 'Open the project and choose an accessible folder, then recheck.' }
    case 'manifest_missing': case 'manifest_unsupported': case 'scripts_missing': return { title: 'Project commands need your input', effect: 'Run and test commands could not be suggested.', next: 'Open the project, review its documentation, and save commands manually.' }
    case 'manifest_invalid': case 'manifest_oversized': case 'manifest_ambiguous': case 'manifest_inaccessible': return { title: 'Project commands could not be verified', effect: 'Automatic command suggestions are unavailable.', next: 'Review the manifest or save commands manually in the project, then recheck.' }
    case 'offline': return { title: 'A connection check could not reach the service', effect: 'Agent readiness is unknown; previous problems remain unresolved.', next: 'Restore connectivity, then recheck.' }
    default: return { title: 'A readiness check could not finish', effect: 'Readiness is unknown; this is not a successful verification.', next: 'Check the tool or folder is available, then recheck. Setup has further guidance.' }
  }
}
function diagnosticAction(scope: DiagnosticScope, check: ReadinessCheck): ProblemAction {
  if (check.action === 'setup') return { kind: 'setup', scope, checkId: check.id }
  if (scope.kind === 'project' && (check.action === 'open-project' || check.action === 'review-commands')) return { kind: 'open-project', projectPath: scope.projectPath }
  return { kind: 'recheck', scope }
}

/** Pure reconciliation. Missing, cancelled, pending, unavailable, stale, and dismissed
 * observations cannot resolve failures. Caller must supply the latest request identity.
 * Keep this state between refreshes, including resolved records. */
export function deriveProblems(previous: ProblemState, input: ProblemsInput): ProblemState {
  const next = { ...previous }
  const put = (id: string, version: number, problem?: Problem) => {
    // Equal timestamps are not newer authoritative evidence.
    if (next[id] && next[id].version >= version) return
    next[id] = { version, problem }
  }
  for (const snapshot of input.diagnostics ?? []) {
    const { result, scope } = snapshot
    if (!result || result.requestId !== snapshot.latestRequestId || ['checking', 'cancelled', 'stale'].includes(result.outcome)) continue
    for (const check of result.checks) {
      if (['checking', 'cancelled', 'stale'].includes(check.outcome)) continue
      const id = JSON.stringify(['readiness', scope.kind, scope.kind === 'project' ? scope.projectPath : '', check.id])
      // A check may complete late; its job's start time defines freshness.
      const version = result.startedAt
      if (check.outcome === 'ready') put(id, version)
      else put(id, version, {
        id, ...diagnosticCopy(check), action: diagnosticAction(scope, check),
        ...(check.action === 'setup' ? { secondary: { kind: 'recheck' as const, scope } } : {})
      })
    }
  }
  for (const task of input.tasks ?? []) {
    const run = task.run
    if (!run) continue
    const runId = JSON.stringify(['task', task.id, 'run'])
    const checkId = JSON.stringify(['task', task.id, 'checks'])
    const version = Math.max(task.updatedAt, run.finishedAt ?? run.startedAt, run.checks?.finishedAt ?? 0)
    const stopped = task.column !== 'running'
    const finished = stopped && !!run.finishedAt && (task.column === 'review' || task.column === 'done')
    const managed = !!task.team || !!task.teamParentId
    if (!stopped) {
      // Retain unresolved failures while removing actions that would duplicate an active run.
      for (const id of [runId, checkId]) {
        const record = next[id]
        if (record?.problem?.secondary) next[id] = { ...record, problem: { ...record.problem, secondary: undefined } }
      }
    }
    if (stopped && (run.error || !run.finishedAt)) put(runId, version, {
      id: runId, title: run.error ? 'A task run failed or stopped' : 'A task run was interrupted',
      effect: 'The task has no confirmed successful result.', next: 'Open the task to inspect its activity and dependencies before choosing to run again.',
      action: { kind: 'open-task', taskId: task.id },
      ...(!managed ? { secondary: { kind: 'retry-task' as const, taskId: task.id } } : {})
    })
    else if (finished && !run.error) put(runId, version)
    if (run.checks?.status === 'failed' || run.checks?.status === 'error') put(checkId, version, {
      id: checkId, title: 'Task checks did not pass', effect: 'The result has not passed project verification.',
      next: 'Open the task and inspect checks. Retry checks after addressing the cause.', action: { kind: 'open-task', taskId: task.id },
      ...(!managed && stopped ? { secondary: { kind: 'retry-checks' as const, taskId: task.id } } : {})
    })
    else if (finished && !run.error && run.checks?.status === 'passed' && run.checks.finishedAt && run.checks.startedAt >= run.startedAt) put(checkId, version)
  }
  for (const review of input.reviews ?? []) {
    const check = review.check
    if (!check || review.checkStale) continue
    const id = JSON.stringify(['review', check.projectPath])
    if (check.state === 'failed' || check.state === 'stopped') put(id, check.finishedAt ?? check.startedAt, {
      id, title: 'Review checks failed or stopped', effect: 'The current changes have no passing verification.',
      next: 'Open Changes, inspect the check outcome, then choose Run checks when ready.',
      action: { kind: 'open-project', projectPath: check.projectPath }
    })
    else if (check.state === 'passed' && check.finishedAt) put(id, check.finishedAt)
  }
  return next
}

export function visibleProblems(state: ProblemState): Problem[] {
  return Object.values(state).flatMap(record => record.problem ? [record.problem] : [])
}
export function problemActionLabel(action: ProblemAction): string {
  return action.kind === 'recheck' ? 'Recheck' : action.kind === 'setup' ? 'Open setup' : action.kind === 'retry-task' ? 'Retry task' : action.kind === 'retry-checks' ? 'Retry checks' : 'Open'
}
