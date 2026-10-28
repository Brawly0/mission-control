import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ClaudeStatus, DocFile, KnowledgeDoc, KnowledgeHit, Note } from '../shared/types'
import { listProjects, normalizePath } from './claudeData'
import { initGit } from './git'
import { agentEnv, whichSync } from './pty'
import { loadStore, updateStore } from './store'

/**
 * v0.11 "hub" pieces: your own notes, a docs index across projects (Knowledge), Claude Code's
 * connection status, your name for the greeting, quick chats and new projects.
 */

function run(file: string, args: string[], timeout = 15_000, acceptFailureOutput = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: agentEnv(), windowsHide: true, timeout, shell: /\.(cmd|bat)$/i.test(file) }, (err, stdout) =>
      err && !(acceptFailureOutput && String(stdout).trim()) ? reject(err) : resolve(String(stdout))
    )
  })
}

// ---------------------------------------------------------------- notes

export function listNotes(): Note[] {
  return [...loadStore().notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
}

export function saveNote(note: Partial<Note> & { id?: string }): Note {
  let saved!: Note
  updateStore((s) => {
    const cur = note.id ? s.notes.find((n) => n.id === note.id) : undefined
    saved = {
      id: cur?.id ?? randomUUID(),
      title: (note.title ?? cur?.title ?? '').slice(0, 200),
      body: note.body ?? cur?.body ?? '',
      pinned: note.pinned ?? cur?.pinned,
      createdAt: cur?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }
    s.notes = cur ? s.notes.map((n) => (n.id === saved.id ? saved : n)) : [saved, ...s.notes]
  })
  return saved
}

export function deleteNote(id: string): void {
  updateStore((s) => {
    s.notes = s.notes.filter((n) => n.id !== id)
  })
}

// ---------------------------------------------------------------- knowledge (docs across projects)

let knowledgeCache: { at: number; docs: KnowledgeDoc[] } | null = null

/** Every project's docs (CLAUDE.md, README, docs/, .claude/), with a title and size. Cached for a minute. */
export async function knowledgeDocs(listDocs: (projectPath: string) => Promise<DocFile[]>): Promise<KnowledgeDoc[]> {
  if (knowledgeCache && Date.now() - knowledgeCache.at < 60_000) return knowledgeCache.docs
  const projects = (await listProjects()).filter((p) => !p.worktree && existsSync(p.path))
  const lists = await Promise.all(
    projects.map(async (p) => {
      const docs = await listDocs(p.path).catch(() => [])
      return Promise.all(
        docs.map(async (d) => {
          const st = await fs.stat(d.path).catch(() => null)
          let title = ''
          try {
            const head = (await fs.readFile(d.path, 'utf8')).slice(0, 2000)
            title = /^#\s+(.+)$/m.exec(head)?.[1]?.trim() ?? ''
          } catch {
            /* unreadable */
          }
          return { ...d, projectPath: p.path, projectName: p.name, title, size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 }
        })
      )
    })
  )
  const docs = lists.flat().sort((a, b) => b.mtime - a.mtime)
  knowledgeCache = { at: Date.now(), docs }
  return docs
}

export function invalidateKnowledge(): void {
  knowledgeCache = null
}

/** Lines matching every word of the query, across all docs (files over 1 MB are skipped). */
export async function searchKnowledge(query: string, listDocs: (projectPath: string) => Promise<DocFile[]>): Promise<KnowledgeHit[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits: KnowledgeHit[] = []
  for (const d of await knowledgeDocs(listDocs)) {
    if (d.size > 1_000_000) continue
    let text = ''
    try {
      text = await fs.readFile(d.path, 'utf8')
    } catch {
      continue
    }
    const lower = text.toLowerCase()
    const inName = words.every((w) => `${d.name} ${d.title} ${d.projectName}`.toLowerCase().includes(w))
    if (!inName && !words.every((w) => lower.includes(w))) continue
    const lines = text.split(/\r?\n/)
    const snippets = lines
      .map((l, i) => ({ line: i + 1, text: l.trim() }))
      .filter((l) => l.text && words.some((w) => l.text.toLowerCase().includes(w)))
      .slice(0, 3)
      .map((l) => ({ ...l, text: l.text.slice(0, 220) }))
    hits.push({ doc: d, snippets })
    if (hits.length >= 80) break
  }
  return hits
}

// ---------------------------------------------------------------- Claude Code status and your name

let statusCache: { at: number; status: ClaudeStatus } | null = null

/** Whether claude is installed and logged in (the account's email is never passed to the UI). Cached for 5 minutes. */
export async function claudeStatus(force = false): Promise<ClaudeStatus> {
  if (process.env.MC_SMOKE && process.env.MC_SMOKE_WORKSPACE) {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.MC_SMOKE_PROVIDER_DELAY || 0)))
    if (process.env.MC_SMOKE_CONNECTION_FIXTURE === 'failure') throw new Error('Fixture Claude status failure')
    return { installed: true, loggedIn: true, version: 'fixture' }
  }
  if (!force && statusCache && Date.now() - statusCache.at < 300_000) return statusCache.status
  const path = whichSync('claude')
  let status: ClaudeStatus = { installed: !!path, loggedIn: false }
  if (path) {
    try {
      status.version = (await run(path, ['--version'])).trim().split(/\s+/)[0]
    } catch {
      /* old version without --version */
    }
    try {
      // A signed-out CLI can exit nonzero while still returning a valid status object.
      const auth = JSON.parse(await run(path, ['auth', 'status'], 15_000, true))
      if (typeof auth?.loggedIn !== 'boolean') throw new Error('Missing authentication status')
      status = { ...status, loggedIn: auth.loggedIn, authMethod: auth.authMethod, plan: auth.subscriptionType }
    } catch {
      status.error = 'Could not check Claude login status.'
    }
  }
  statusCache = { at: Date.now(), status }
  return status
}

let codexStatusCache: { at: number; status: ClaudeStatus } | null = null

/** Check the CLI itself, never infer authentication from old chat files. */
export async function codexStatus(force = false): Promise<ClaudeStatus> {
  if (process.env.MC_SMOKE && process.env.MC_SMOKE_WORKSPACE) {
    await new Promise(resolve => setTimeout(resolve, Number(process.env.MC_SMOKE_PROVIDER_DELAY || 0)))
    return { installed: true, loggedIn: true, version: 'fixture' }
  }
  if (!force && codexStatusCache && Date.now() - codexStatusCache.at < 300_000) return codexStatusCache.status
  const path = whichSync('codex')
  const status: ClaudeStatus = { installed: !!path, loggedIn: false }
  if (path) {
    status.version = (await run(path, ['--version'])).trim()
    status.loggedIn = await new Promise<boolean>((resolve, reject) => {
      execFile(path, ['login', 'status'], { env: agentEnv(), windowsHide: true, timeout: 15000, shell: /\.(cmd|bat)$/i.test(path) }, (err, stdout, stderr) => {
        const text = String(stdout) + String(stderr)
        if (/not logged in/i.test(text)) resolve(false)
        else if (!err && /logged in/i.test(text)) resolve(true)
        else reject(new Error('Could not check Codex login status'))
      })
    })
  }
  codexStatusCache = { at: Date.now(), status }
  return status
}

let windowsName: string | null = null

/** Your first name for the greeting: the one in Settings, else the first word of your Windows account's full name. */
export async function userName(): Promise<string> {
  const own = loadStore().settings.userName?.trim()
  if (own) return own
  // Clean fixtures must never expose the Windows identity.
  if (process.env.MC_SMOKE_CLEAN) return ''
  if (windowsName === null) {
    try {
      const full = await run('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_UserAccount -Filter \"Name='$env:USERNAME'\").FullName"], 8000)
      windowsName = full.trim().split(/\s+/)[0] ?? ''
    } catch {
      windowsName = ''
    }
  }
  return windowsName
}

// ---------------------------------------------------------------- quick chats and new projects

/** A fresh folder in Windows' temp folder for a throwaway chat; it shows under "worktrees & scratch", not as a project. */
export function quickChatFolder(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const dir = join(tmpdir(), 'mission-control-quick-chats', stamp)
  mkdirSync(dir, { recursive: true })
  return dir
}

const STARTER_CLAUDE_MD = (name: string) => `# ${name}

Notes for Claude about this project.

- What it is:
- How to run it:
- Conventions:
`

/** Creates a project folder (optionally with a CLAUDE.md and git) and adds it to the sidebar. */
export async function createProject(opts: { parent: string; name: string; claudeMd: boolean; git: boolean }): Promise<string> {
  const name = opts.name.trim()
  if (!name || /[<>:"/\\|?*]/.test(name)) throw new Error('Use a folder name without < > : " / \\ | ? *')
  const dir = join(opts.parent, name)
  if (existsSync(dir)) throw new Error(`${dir} already exists. Use "Add an existing folder" instead.`)
  mkdirSync(dir, { recursive: true })
  if (opts.claudeMd) writeFileSync(join(dir, 'CLAUDE.md'), STARTER_CLAUDE_MD(name), 'utf8')
  if (opts.git) await initGit(dir)
  updateStore((s) => {
    if (!s.manualProjects.some((p) => normalizePath(p) === normalizePath(dir))) s.manualProjects.push(dir)
  })
  invalidateKnowledge()
  return dir
}
