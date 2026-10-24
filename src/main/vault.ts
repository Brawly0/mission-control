import { watch, promises as fs, type FSWatcher } from 'node:fs'
import { join, relative } from 'node:path'
import type { Task, VaultInfo, VaultNote } from '../shared/types'
import { buildVaultPrompt, noteName, parseNote, resolveLink, updateVaultPrompt } from '../shared/vault'
import { createTask, listTasks, startTask } from './tasks'

/**
 * Project docs vaults (ADR 0014): the Markdown notes in a project's docs/ folder plus its root
 * docs (CLAUDE.md, README.md…), read as an Obsidian-style vault with [[wikilinks]]. Claude
 * writes and updates the notes through ordinary headless tasks, so they show on the Tasks board
 * with their cost; this module only reads the files, watches them, and starts those tasks.
 */

const ROOT_FILES = ['CLAUDE.md', 'README.md', 'AGENTS.md', 'BRIEFING.md', 'CONTRIBUTING.md', 'CHANGELOG.md']
const MAX_NOTES = 600
const MAX_DEPTH = 6
/** Bigger files are listed but not parsed for links. */
const MAX_PARSE_BYTES = 1024 * 1024
export const VAULT_TASK_PREFIX = 'Docs vault: '

async function collect(projectPath: string): Promise<string[]> {
  const files: string[] = []
  for (const name of ROOT_FILES) {
    try {
      if ((await fs.stat(join(projectPath, name))).isFile()) files.push(join(projectPath, name))
    } catch {
      /* not there */
    }
  }
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.length >= MAX_NOTES) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (files.length >= MAX_NOTES) return
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) files.push(p)
    }
  }
  await walk(join(projectPath, 'docs'), 0)
  return files
}

export async function vaultNotes(projectPath: string): Promise<VaultInfo> {
  const files = await collect(projectPath)
  const read = await Promise.all(
    files.map(async (path) => {
      const rel = relative(projectPath, path).replace(/\\/g, '/')
      try {
        const st = await fs.stat(path)
        const text = st.size <= MAX_PARSE_BYTES ? await fs.readFile(path, 'utf8') : ''
        return { path, rel, st, parsed: parseNote(text), text }
      } catch {
        return null
      }
    })
  )
  const ok = read.filter((r): r is NonNullable<typeof r> => r !== null)
  const rels = ok.map((r) => r.rel)
  const notes: VaultNote[] = ok.map(({ path, rel, st, parsed }) => {
    const links = new Set<string>()
    const unresolved: string[] = []
    for (const target of parsed.links) {
      const hit = resolveLink(target, rel, rels)
      if (hit && hit !== rel) links.add(hit)
      else if (!hit) unresolved.push(target)
    }
    return {
      path,
      rel,
      name: noteName(rel),
      // Root files go by their file name: CLAUDE.md and README.md often share a title.
      title: rel.includes('/') ? parsed.title || noteName(rel) : rel,
      folder: rel.includes('/') ? rel.replace(/\/[^/]*$/, '') : '',
      mtime: st.mtimeMs,
      size: st.size,
      tags: parsed.tags,
      links: [...links],
      unresolved,
      generated: parsed.props.generated === 'claude'
    }
  })
  const claudeMd = ok.find((r) => r.rel === 'CLAUDE.md')
  return {
    projectPath,
    notes,
    hasIndex: rels.some((r) => r.toLowerCase() === 'docs/index.md'),
    claudeMdLinked: !!claudeMd && /docs\/INDEX\.md/i.test(claudeMd.text),
    updatedAt: Math.max(0, ...notes.filter((n) => n.generated).map((n) => n.mtime))
  }
}

/** The vault task running in this project, if any. */
function runningVaultTask(projectPath: string): Task | undefined {
  return listTasks().find((t) => t.projectPath === projectPath && t.title.startsWith(VAULT_TASK_PREFIX) && t.column === 'running')
}

/**
 * Starts Claude on the vault: "build" reads the project and writes all the notes; "update"
 * brings them up to date with what changed. Sonnet by default: writing docs doesn't need Opus.
 */
export async function buildVault(projectPath: string, projectName: string, mode: 'build' | 'update', model?: string): Promise<Task> {
  if (runningVaultTask(projectPath)) throw new Error('Claude is already writing this vault.')
  const today = new Date().toLocaleDateString('sv')
  let prompt = buildVaultPrompt(today)
  if (mode === 'update') {
    const info = await vaultNotes(projectPath)
    const since = info.updatedAt ? new Date(info.updatedAt).toLocaleDateString('sv') : 'an unknown date'
    prompt = info.hasIndex ? updateVaultPrompt(today, since) : prompt
  }
  const task = createTask({
    title: `${VAULT_TASK_PREFIX}${mode === 'build' ? 'build' : 'update'}`,
    prompt,
    projectPath,
    projectName,
    mode: 'headless',
    permission: 'acceptEdits',
    useWorktree: false,
    model: model || 'sonnet'
  })
  await startTask(task.id)
  return task
}

// ---------------------------------------------------------------- live updates

let watcher: { path: string; handles: FSWatcher[] } | null = null
let debounce: NodeJS.Timeout | null = null

/** Watches one project's docs/ and root notes; `changed` fires (debounced) when a Markdown file changes. */
export function watchVault(projectPath: string | null, changed: (projectPath: string) => void): void {
  if (watcher?.path === projectPath) return
  watcher?.handles.forEach((h) => h.close())
  watcher = null
  if (!projectPath) return
  const fire = (file: string | null) => {
    if (file && !/\.md$/i.test(file)) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => changed(projectPath), 400)
  }
  const handles: FSWatcher[] = []
  let hasDocs = false
  for (const [dir, recursive] of [[join(projectPath, 'docs'), true], [projectPath, false]] as const) {
    try {
      const h = watch(dir, { recursive }, (_e, file) => {
        // docs/ appeared (Claude's first note): start watching inside it.
        if (!recursive && !hasDocs && String(file) === 'docs') {
          watcher?.handles.forEach((x) => x.close())
          watcher = null
          watchVault(projectPath, changed)
        }
        fire(file ? String(file) : null)
      })
      if (recursive) hasDocs = true
      h.on('error', () => h.close())
      handles.push(h)
    } catch {
      /* folder missing: no docs/ yet */
    }
  }
  watcher = { path: projectPath, handles }
}

export function stopVaultWatch(): void {
  watchVault(null, () => undefined)
}
