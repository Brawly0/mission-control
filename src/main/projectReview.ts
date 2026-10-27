import type { AgentTool, ProjectReview, WorktreeInfo } from '../shared/types'
import { worktreeParent } from '../shared/projectLook'
import { getChanges, mergeWorktree, reviewFingerprint } from './git'
import { normalizePath } from './claudeData'
import { loadStore } from './store'
import { projectRuns, startConfiguredCommand } from './projectCommands'
import { createTask, listTasks, setTaskRun, startTask } from './tasks'

const checks = new Map<string, { id: string; fingerprint: string; command: string }>()
const reviews = new Map<string, { id: string; fingerprint: string }>()
const startingChecks = new Set<string>()
const startingReviews = new Set<string>()

export async function mergeReviewedWorktree(worktree: WorktreeInfo, fingerprint: string) {
  const snapshot = await projectReview(worktree.path, worktree.base)
  if (snapshot.fingerprint !== fingerprint) throw new Error('Files changed since you reviewed them. Refresh and review again.')
  if (snapshot.checkCommand && (!snapshot.check || snapshot.check.state !== 'passed' || snapshot.checkStale)) throw new Error('Run the configured checks on the current changes before merging.')
  return mergeWorktree(worktree)
}

export async function projectReview(path: string, base?: string): Promise<ProjectReview> {
  const changes = await getChanges(path, base)
  const fingerprint = await reviewFingerprint(path, changes)
  const projectPath = worktreeParent(path)?.parent ?? path
  const checkCommand = loadStore().projectMeta[normalizePath(projectPath)]?.checkCommand ?? ''
  const key = normalizePath(path), check = checks.get(key), review = reviews.get(key)
  return { changes, fingerprint, projectPath, checkCommand,
    check: check ? projectRuns(path).find(r => r.id === check.id) : undefined,
    checkStale: !!check && (check.fingerprint !== fingerprint || check.command !== checkCommand),
    review: review ? listTasks().find(t => t.id === review.id) : undefined,
    reviewStale: !!review && review.fingerprint !== fingerprint }
}
export async function startReviewChecks(path: string, base?: string) {
  const key = normalizePath(path)
  if (startingChecks.has(key)) throw new Error('Checks are starting.')
  startingChecks.add(key)
  try {
    const snapshot = await projectReview(path, base)
    if (!snapshot.checkCommand.trim()) throw new Error('Set the project check command first.')
    const run = startConfiguredCommand(path, { id: '__review_checks', name: 'Review checks', command: snapshot.checkCommand })
    checks.set(key, { id: run.id, fingerprint: snapshot.fingerprint, command: snapshot.checkCommand })
  } finally { startingChecks.delete(key) }
}
export async function startCodeReview(path: string, base?: string, tool: AgentTool = 'codex') {
  const key = normalizePath(path)
  if (startingReviews.has(key)) throw new Error('Review is starting.')
  startingReviews.add(key)
  try {
    const snapshot = await projectReview(path, base)
    if (snapshot.review?.column === 'running') throw new Error('A review is already running.')
    const task = createTask({ tool, title: `Review changes (${tool})`, projectPath: path, projectName: path.split(/[\\/]/).pop() || path, mode: 'headless', permission: 'plan', useWorktree: false,
      prompt: `Review this checkout read-only. Do not edit files or commit anything. Inspect git status and ${base ? 'the diff against the merge-base with ' + JSON.stringify(base) : 'all uncommitted changes against HEAD'}, including untracked source files. Report actionable bugs with file/line references, then any testing gaps. If you find none, say so. The user will review and decide whether to merge.` })
    reviews.set(key, { id: task.id, fingerprint: snapshot.fingerprint })
    try { await startTask(task.id) }
    catch (e) { setTaskRun(task.id, { startedAt: Date.now(), finishedAt: Date.now(), error: (e as Error).message, toolCalls: 0, events: [] }, 'review'); throw e }
  } finally { startingReviews.delete(key) }
}
