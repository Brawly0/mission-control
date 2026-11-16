import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input, windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd()
}

export function tryGit(cwd: string, args: string[]): string | undefined {
  try { return git(cwd, args) } catch { return undefined }
}

export function repoRoot(cwd: string): string | undefined {
  return tryGit(cwd, ['rev-parse', '--show-toplevel'])?.replace(/\//g, process.platform === 'win32' ? '\\' : '/')
}

function commonDir(root: string): string {
  const dir = git(root, ['rev-parse', '--git-common-dir'])
  return isAbsolute(dir) ? dir : resolve(root, dir)
}

export interface Run {
  id: string
  request: string
  branch: string
  base: string
  baseCommit: string
  worktree: string
  root: string
  createdAt: number
  status: 'planning' | 'working' | 'reviewing' | 'done' | 'failed' | 'stopped' | 'merged'
  commit?: string
  sessions?: Partial<Record<'claude' | 'codex', string>>
  error?: string
}

/** Runs are remembered in the repository's own .git folder, so nothing is written to the working tree or ~/.claude. */
function runsDir(root: string): string {
  const dir = join(commonDir(root), 'mc-runs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function saveRun(run: Run): void {
  writeFileSync(join(runsDir(run.root), `${run.id}.json`), JSON.stringify(run, null, 2))
}

export function listRuns(root: string): Run[] {
  const dir = runsDir(root)
  return readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => {
    try { return [JSON.parse(readFileSync(join(dir, f), 'utf8')) as Run] } catch { return [] }
  }).sort((a, b) => b.createdAt - a.createdAt)
}

export function findRun(root: string, id: string): Run | undefined {
  const runs = listRuns(root)
  return runs.find(r => r.id === id) ?? (id ? runs.filter(r => r.id.startsWith(id)).at(0) : runs[0])
}

/**
 * A fresh worktree on a new mc/duo-<id> branch from HEAD, under <repo>/.claude/worktrees/ where
 * Mission Control already lists worktree chats under their project. That folder is excluded locally.
 */
export function createWorktree(root: string, id: string): { path: string; branch: string; base: string; baseCommit: string } {
  const base = tryGit(root, ['symbolic-ref', '--short', 'HEAD']) ?? 'HEAD'
  const baseCommit = git(root, ['rev-parse', 'HEAD'])
  const branch = `mc/duo-${id}`
  const path = join(root, '.claude', 'worktrees', `duo-${id}`)
  const exclude = join(commonDir(root), 'info', 'exclude')
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (!/^\/?\.claude\/worktrees\/?$/m.test(current)) {
    mkdirSync(join(commonDir(root), 'info'), { recursive: true })
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}.claude/worktrees/\n`)
  }
  git(root, ['worktree', 'add', '-b', branch, path, baseCommit])
  return { path, branch, base, baseCommit }
}

/** Changes in the given paths since the run started, with new files included (marked intent-to-add first). */
export function diffFor(worktree: string, baseCommit: string, paths: string[], max = 60_000): string {
  tryGit(worktree, ['add', '-N', '--', ...paths])
  const diff = tryGit(worktree, ['diff', baseCommit, '--', ...paths]) ?? ''
  return diff.length > max ? diff.slice(0, max) + `\n… (diff cut at ${max} characters; read the files for the rest)` : diff
}

export function changedFiles(worktree: string, baseCommit: string): string[] {
  tryGit(worktree, ['add', '-N', '.'])
  return (tryGit(worktree, ['diff', '--name-only', baseCommit]) ?? '').split(/\r?\n/).filter(Boolean)
}

/** Commits everything in the worktree; returns the short hash, or nothing when there was nothing to commit. */
export function commitAll(worktree: string, message: string): string | undefined {
  git(worktree, ['add', '-A'])
  if (!tryGit(worktree, ['diff', '--cached', '--name-only'])) return undefined
  git(worktree, ['commit', '-q', '-F', '-'], message)
  return git(worktree, ['rev-parse', '--short', 'HEAD'])
}

export function removeWorktree(root: string, run: Run, deleteBranch: boolean): void {
  if (existsSync(run.worktree)) tryGit(root, ['worktree', 'remove', '--force', run.worktree])
  tryGit(root, ['worktree', 'prune'])
  if (deleteBranch) tryGit(root, ['branch', '-D', run.branch])
}

export function deleteRun(root: string, id: string): void {
  rmSync(join(runsDir(root), `${id}.json`), { force: true })
}
