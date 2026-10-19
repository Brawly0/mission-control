import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { ChangedFile, GitChanges, GitInfo, WorktreeInfo } from '../shared/types'

/** Runs git and resolves with stdout; rejects with git's own error text. */
function git(cwd: string, args: string[], allowExit1 = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout, stderr) => {
        if (err && !(allowExit1 && (err as any).code === 1)) {
          reject(new Error((stderr || err.message).trim()))
        } else {
          resolve(stdout)
        }
      }
    )
  })
}

const infoCache = new Map<string, { at: number; info: GitInfo }>()
const INFO_TTL_MS = 5000

export async function gitInfo(path: string): Promise<GitInfo> {
  const cached = infoCache.get(path)
  if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.info

  let info: GitInfo = { isRepo: false }
  if (existsSync(path)) {
    try {
      const [top, commonDir, status] = await Promise.all([
        git(path, ['rev-parse', '--show-toplevel']),
        git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
        git(path, ['status', '--porcelain=v1', '-b'])
      ])
      const lines = status.split('\n').filter(Boolean)
      const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
      // "## main...origin/main [ahead 1, behind 2]" or "## HEAD (no branch)" or "## No commits yet on main"
      const branch = head.replace(/^No commits yet on /, '').split('...')[0].split(' ')[0]
      const root = top.trim().replace(/\//g, '\\')
      const mainRoot = dirname(commonDir.trim()).replace(/\//g, '\\')
      info = {
        isRepo: true,
        root,
        branch: branch === 'HEAD' ? 'detached' : branch,
        dirty: lines.length,
        ahead: Number(head.match(/ahead (\d+)/)?.[1] ?? 0),
        behind: Number(head.match(/behind (\d+)/)?.[1] ?? 0),
        isWorktree: root.toLowerCase() !== mainRoot.toLowerCase(),
        mainRoot
      }
    } catch {
      info = { isRepo: false }
    }
  }
  infoCache.set(path, { at: Date.now(), info })
  return info
}

export async function gitInfoMany(paths: string[]): Promise<Record<string, GitInfo>> {
  const out: Record<string, GitInfo> = {}
  // A few at a time: each call starts three git processes.
  const queue = [...paths]
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const p = queue.shift()!
        out[p] = await gitInfo(p)
      }
    })
  )
  return out
}

/**
 * Creates a worktree + branch for one agent, under <repo>/.claude/worktrees/<name>, the same place
 * Claude Code puts its own worktrees. The folder is excluded locally so the main checkout stays clean.
 */
export async function createWorktree(projectPath: string): Promise<WorktreeInfo> {
  const info = await gitInfo(projectPath)
  if (!info.isRepo || !info.mainRoot) throw new Error('This folder is not a git repository.')
  const repoRoot = info.mainRoot
  const base = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (base === 'HEAD') throw new Error('The main checkout is on a detached HEAD; check out a branch first.')
  try {
    await git(repoRoot, ['rev-parse', '--verify', 'HEAD'])
  } catch {
    throw new Error('The repository has no commits yet. Make a first commit, then try again.')
  }

  const name = `agent-${randomBytes(2).toString('hex')}`
  const branch = `mc/${name}`
  const path = join(repoRoot, '.claude', 'worktrees', name)

  const exclude = join(repoRoot, '.git', 'info', 'exclude')
  try {
    const current = existsSync(exclude) ? await fs.readFile(exclude, 'utf8') : ''
    if (!current.split(/\r?\n/).includes('.claude/worktrees/')) {
      await fs.mkdir(dirname(exclude), { recursive: true })
      await fs.appendFile(exclude, `${current.endsWith('\n') || !current ? '' : '\n'}.claude/worktrees/\n`)
    }
  } catch {
    /* not fatal: the folder just shows as untracked */
  }

  await git(repoRoot, ['worktree', 'add', '-b', branch, path, base])
  infoCache.clear()
  return { path, branch, base, repoRoot }
}

function parseNameStatus(text: string, staged: boolean): ChangedFile[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, ...rest] = line.split('\t')
      return { path: rest[rest.length - 1], status: code[0] as ChangedFile['status'], staged }
    })
}

const MAX_UNTRACKED_BYTES = 200 * 1024

/**
 * Everything that differs from `base`: commits on this branch plus uncommitted and untracked work.
 * Without a base (a normal project), it's just the uncommitted changes against HEAD.
 */
export async function getChanges(path: string, base?: string): Promise<GitChanges> {
  const info = await gitInfo(path)
  if (!info.isRepo) return { files: [], diff: '', commits: [], base: base ?? 'HEAD' }

  let from = 'HEAD'
  let commits: string[] = []
  if (base) {
    from = (await git(path, ['merge-base', base, 'HEAD'])).trim()
    commits = (await git(path, ['log', '--oneline', `${from}..HEAD`])).split('\n').filter(Boolean)
  } else {
    try {
      await git(path, ['rev-parse', '--verify', 'HEAD'])
    } catch {
      // No commits yet: compare against git's empty tree.
      from = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    }
  }

  const [nameStatus, diff, untracked] = await Promise.all([
    git(path, ['diff', '--name-status', '-M', from]),
    git(path, ['diff', '-M', '--no-color', from]),
    git(path, ['ls-files', '--others', '--exclude-standard'])
  ])
  const files = parseNameStatus(nameStatus, false)

  let untrackedDiff = ''
  for (const file of untracked.split('\n').filter(Boolean)) {
    files.push({ path: file, status: '?', staged: false })
    try {
      const full = join(path, file)
      const stat = await fs.stat(full)
      if (stat.size > MAX_UNTRACKED_BYTES) {
        untrackedDiff += `diff --git a/${file} b/${file}\nnew file\n@@ large file (${stat.size} bytes) not shown @@\n`
        continue
      }
      const content = await fs.readFile(full, 'utf8')
      if (content.includes('\u0000')) {
        untrackedDiff += `diff --git a/${file} b/${file}\nnew file\nBinary file not shown\n`
        continue
      }
      const lines = content.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      untrackedDiff +=
        `diff --git a/${file} b/${file}\nnew file\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n` +
        lines.map((l) => '+' + l).join('\n') +
        '\n'
    } catch {
      /* unreadable; listed without content */
    }
  }

  return { files, diff: diff + untrackedDiff, commits, base: base ?? 'HEAD' }
}

export async function commitAll(path: string, message: string): Promise<void> {
  await git(path, ['add', '-A'])
  await git(path, ['commit', '-m', message])
  infoCache.clear()
}

/** Merges a worktree's branch into its base branch in the main checkout. */
export async function mergeWorktree(wt: WorktreeInfo): Promise<string> {
  const status = await git(wt.path, ['status', '--porcelain'])
  if (status.trim()) throw new Error('The worktree has uncommitted changes. Commit them first.')
  const mainBranch = (await git(wt.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (mainBranch !== wt.base) {
    throw new Error(`The main checkout is on "${mainBranch}", not "${wt.base}". Switch it to ${wt.base} first.`)
  }
  const mainStatus = (await git(wt.repoRoot, ['status', '--porcelain'])).trim()
  if (mainStatus) throw new Error('The main checkout has uncommitted changes. Commit or stash them first.')
  const out = await git(wt.repoRoot, ['merge', '--no-ff', '--no-edit', wt.branch, '-m', `Merge ${wt.branch} into ${wt.base}`])
  infoCache.clear()
  return out.trim()
}

/** Deletes the worktree folder and its branch. Callers must confirm with the user first. */
export async function removeWorktree(wt: WorktreeInfo): Promise<void> {
  // Only touch folders this app created.
  const rel = relative(join(wt.repoRoot, '.claude', 'worktrees'), wt.path)
  if (rel.startsWith('..') || !wt.branch.startsWith('mc/')) throw new Error('Not a Mission Control worktree.')
  // Windows releases a folder a moment after the last process using it exits; retry briefly.
  for (let attempt = 1; ; attempt++) {
    try {
      await git(wt.repoRoot, ['worktree', 'remove', '--force', wt.path])
      break
    } catch (e) {
      if (attempt >= 5 || !/permission denied|being used|busy/i.test(String(e))) throw e
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  try {
    await git(wt.repoRoot, ['branch', '-D', wt.branch])
  } catch {
    /* branch already gone */
  }
  infoCache.clear()
}
