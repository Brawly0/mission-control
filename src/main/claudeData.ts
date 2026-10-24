import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ChatMessage, Project, ProjectMeta, RecentSession, SessionDetail, SessionSummary } from '../shared/types'
import {
  PROJECT_HUES,
  encodeProjectKey,
  folderLabel,
  guessIcon,
  pickProject,
  prettyWorktreeName,
  projectRootOf,
  readmeInfo,
  titleFromPrompt,
  worktreeParent
} from '../shared/projectLook'
import { loadStore, updateStore, type StoreData } from './store'

/**
 * Read-only access to Claude Code's on-disk data in ~/.claude/projects.
 * Each subfolder is one working directory; each *.jsonl file is one session.
 * Session files can be tens of MB, so listings only read a file's head and tail.
 */

export const claudeProjectsDir = join(homedir(), '.claude', 'projects')

const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 128 * 1024
const MAX_MESSAGES = 600

const summaryCache = new Map<string, { mtime: number; summary: SessionSummary }>()

export function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, '').toLowerCase()
}

/** Lossy fallback: 'C--Users-me-Desktop-bot' -> 'C:\Users\me\Desktop\bot'. */
function decodeKey(key: string): string {
  const m = key.match(/^([A-Za-z])--(.*)$/)
  if (!m) return key
  return `${m[1].toUpperCase()}:\\${m[2].replace(/-/g, '\\')}`
}

async function readRange(file: string, start: number, length: number): Promise<string> {
  const handle = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, start)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

function parseLines(chunk: string, dropFirst: boolean, dropLast: boolean): any[] {
  const lines = chunk.split('\n')
  if (dropFirst) lines.shift()
  if (dropLast) lines.pop()
  const out: any[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* partial or malformed line */
    }
  }
  return out
}

/** Extracts plain text from a user/assistant message, ignoring tool calls and tool results. */
function messageText(entry: any): string {
  const content = entry?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
  }
  return ''
}

function isHumanPrompt(entry: any): boolean {
  if (entry?.type !== 'user' || entry.isMeta || entry.isSidechain) return false
  const text = messageText(entry).trim()
  return text.length > 0 && !text.startsWith('<')
}

function ts(value: unknown): number {
  const n = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(n) ? 0 : n
}

export async function summarizeSession(projectKey: string, file: string): Promise<SessionSummary> {
  const stat = await fs.stat(file)
  const cached = summaryCache.get(file)
  if (cached && cached.mtime === stat.mtimeMs) return cached.summary

  const headLen = Math.min(stat.size, HEAD_BYTES)
  const head = parseLines(await readRange(file, 0, headLen), false, headLen < stat.size)
  const tailStart = Math.max(headLen, stat.size - TAIL_BYTES)
  const tail =
    tailStart < stat.size ? parseLines(await readRange(file, tailStart, stat.size - tailStart), true, false) : []

  const firstPromptEntry = head.find(isHumanPrompt)
  const withCwd = head.find((e) => typeof e?.cwd === 'string')
  const newestFirst = [...tail, ...head].reverse()
  // A title set with /rename wins over the automatic name Claude Code gives a chat.
  const customTitle = newestFirst.find((e) => e?.type === 'custom-title' && e.customTitle)?.customTitle
  const agentName = newestFirst.find((e) => e?.type === 'agent-name' && e.agentName)?.agentName
  const firstPrompt = firstPromptEntry ? messageText(firstPromptEntry).trim() : ''
  const startedAt = ts(head.find((e) => e?.timestamp)?.timestamp) || stat.birthtimeMs

  const summary: SessionSummary = {
    id: basename(file, '.jsonl'),
    projectKey,
    title: customTitle || agentName || titleFromPrompt(firstPrompt) || '(empty session)',
    firstPrompt: firstPrompt.slice(0, 500),
    cwd: withCwd?.cwd ?? '',
    gitBranch: withCwd?.gitBranch && withCwd.gitBranch !== 'HEAD' ? withCwd.gitBranch : '',
    worktree: worktreeName(withCwd?.cwd ?? ''),
    startedAt,
    updatedAt: stat.mtimeMs,
    sizeBytes: stat.size
  }
  summaryCache.set(file, { mtime: stat.mtimeMs, summary })
  return summary
}

async function sessionFiles(projectKey: string): Promise<string[]> {
  const dir = join(claudeProjectsDir, projectKey)
  try {
    const names = await fs.readdir(dir)
    return names.filter((n) => n.endsWith('.jsonl')).map((n) => join(dir, n))
  } catch {
    return []
  }
}

function worktreeName(cwd: string): string | undefined {
  const wt = worktreeParent(cwd)
  return wt ? prettyWorktreeName(wt.name) : undefined
}

/** Applies the titles you set in Mission Control (kept apart from the cached summaries). */
function withOwnTitle(s: SessionSummary, titles: Record<string, string>): SessionSummary {
  const own = titles[s.id]
  return own ? { ...s, title: own, renamed: true } : s
}

/** Chats from one or more ~/.claude/projects folders (a project and its worktrees), newest first. */
/**
 * Chats from one or more ~/.claude/projects folders (a project and its worktrees), newest first.
 * With `projectPath`, chats matched to another project are left out and chats matched to this one
 * (for example started from C:\ but spent in this folder) are added.
 */
export async function listSessions(projectKey: string | string[], projectPath?: string): Promise<SessionSummary[]> {
  const keys = [...new Set(Array.isArray(projectKey) ? projectKey : [projectKey])].filter(Boolean)
  const titles = loadStore().chatTitles
  const here = projectPath ? normalizePath(projectPath) : ''
  const lists = await Promise.all(
    keys.map(async (key) => {
      const files = await sessionFiles(key)
      const results = await Promise.allSettled(files.map((f) => summarizeSession(key, f)))
      return results.flatMap((r) => (r.status === 'fulfilled' ? [withOwnTitle(r.value, titles)] : []))
    })
  )
  let list = lists.flat()
  if (here) {
    list = list.filter((x) => {
      const moved = movedChats.get(x.id)
      return !moved || normalizePath(moved.path) === here
    })
    const incoming = [...movedChats.entries()].filter(([, m]) => normalizePath(m.path) === here && !keys.includes(m.key))
    const extra = await Promise.allSettled(incoming.map(([id, m]) => summarizeSession(m.key, join(claudeProjectsDir, m.key, `${id}.jsonl`))))
    list.push(...extra.flatMap((r) => (r.status === 'fulfilled' ? [withOwnTitle(r.value, titles)] : [])))
    list = list.map((x) => {
      const moved = movedChats.get(x.id)
      return moved ? { ...x, movedFrom: folderLabel(moved.from), movedByYou: moved.byYou } : x
    })
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Files or folders that make a folder a project, for telling "Desktop\Projects" (a container) from a project. */
const MARKERS = ['.git', 'package.json', 'README.md', 'README.txt', 'CLAUDE.md', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml']
const markerCache = new Map<string, boolean>()
function hasMarker(dir: string): boolean {
  const key = dir.toLowerCase()
  let v = markerCache.get(key)
  if (v === undefined) {
    v = MARKERS.some((m) => existsSync(join(dir, m)))
    markerCache.set(key, v)
  }
  return v
}

/** The folders each chat worked in, from the chat index (wired up in index.ts; empty until the index has run). */
let folderSource: (sessionIds: string[]) => Promise<Record<string, { folder: string; hits: number }[]>> = async () => ({})
export function setFolderSource(fn: typeof folderSource): void {
  folderSource = fn
}

/** Folders each chat worked in, as last read from the index, with the chat file time they belong to. */
const folderCache = new Map<string, { mtime: number; folders: { folder: string; hits: number }[] }>()

/** Chats shown under a different project than the folder they started in, by session id. Rebuilt by listProjects. */
let movedChats = new Map<string, { path: string; key: string; from: string; byYou: boolean }>()

/** Chats currently shown under another project than where they started. */
export function movedChatList(): { id: string; path: string }[] {
  return [...movedChats.entries()].map(([id, m]) => ({ id, path: m.path }))
}

/** Files a chat under another project (`path`), or back to automatic matching (empty). */
export function moveSession(sessionId: string, path: string): void {
  updateStore((s) => {
    if (path) s.chatProjects[sessionId] = path
    else delete s.chatProjects[sessionId]
  })
}

export function renameSession(sessionId: string, title: string): void {
  updateStore((s) => {
    const t = title.trim().slice(0, 120)
    if (t) s.chatTitles[sessionId] = t
    else delete s.chatTitles[sessionId]
  })
}

const readmeCache = new Map<string, { mtime: number; text: string }>()

/** The start of a project's README (cached by modification time), or '' when there is none. */
async function readmeText(path: string): Promise<string> {
  for (const name of ['README.md', 'README.txt', 'README', 'BRIEFING.md', 'CLAUDE.md']) {
    const file = join(path, name)
    try {
      const st = await fs.stat(file)
      if (!st.isFile()) continue
      const hit = readmeCache.get(file)
      if (hit && hit.mtime === st.mtimeMs) return hit.text
      const text = await readRange(file, 0, Math.min(st.size, 8192))
      readmeCache.set(file, { mtime: st.mtimeMs, text })
      return text
    } catch {
      /* try the next name */
    }
  }
  return ''
}

/** Same hue for the same folder every time, so a project keeps its color until you pick one. */
function nameHue(name: string): number {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PROJECT_HUES[h % PROJECT_HUES.length]
}

/** The readable name, description, icon and color for a project. */
async function describe(path: string, meta: ProjectMeta): Promise<Pick<Project, 'name' | 'folderName' | 'description' | 'icon' | 'hue'>> {
  const folderName = folderLabel(path)
  const readme = existsSync(path) ? await readmeText(path) : ''
  const info = readme ? readmeInfo(readme, folderName) : { title: '', description: '' }
  return {
    name: meta.displayName?.trim() || info.title || folderName,
    folderName,
    description: info.description || undefined,
    icon: meta.icon ?? guessIcon(folderName, readme, path),
    hue: meta.hue ?? nameHue(folderName)
  }
}

export async function listProjects(): Promise<Project[]> {
  const store = loadStore()
  const pinned = new Set(store.pinned.map(normalizePath))
  const byPath = new Map<string, Project>()

  let keys: string[] = []
  try {
    const entries = await fs.readdir(claudeProjectsDir, { withFileTypes: true })
    keys = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    /* Claude Code has never run on this machine */
  }

  const found = (
    await Promise.all(
      keys.map(async (key) => {
        const files = await sessionFiles(key)
        if (files.length === 0) {
          // Claude Code was opened here (it keeps memory for the folder) but no chat was saved.
          // Only a folder that is a project itself: "WBP\backend" is part of WBP, not a project of its own.
          const path = decodeKey(key)
          const root = projectRootOf(path, homedir(), hasMarker)
          const isProject = !!root && normalizePath(root) === normalizePath(path)
          return existsSync(path) && isProject ? { key, path, sessionCount: 0, lastActivity: 0, chats: [] } : null
        }
        const stats = await Promise.all(files.map((f) => fs.stat(f).then((s) => ({ f, s }))))
        stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)
        let path = ''
        try {
          path = (await summarizeSession(key, stats[0].f)).cwd
        } catch {
          /* fall through to decoded key */
        }
        const chats = stats.map((x) => ({ id: basename(x.f, '.jsonl'), mtime: x.s.mtimeMs }))
        return { key, path: path || decodeKey(key), sessionCount: files.length, lastActivity: stats[0].s.mtimeMs, chats }
      })
    )
  ).filter((x) => x !== null)

  const blank = (path: string, manual: boolean): Project => ({
    key: '',
    keys: [],
    path,
    name: '',
    folderName: '',
    icon: 'Folder',
    hue: 0,
    sessionCount: 0,
    lastActivity: 0,
    pinned: pinned.has(normalizePath(path)),
    manual,
    worktree: /[\\/]\.claude[\\/]worktrees[\\/]|[\\/]scratch-workspaces[\\/]|[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(path),
    meta: metaFor(store, path)
  })

  for (const f of found) {
    // Chats from a project's Claude Code worktrees belong to the project itself, so
    // "WBP\.claude\worktrees\semester-planning-2b8af2" shows up under WBP, not as a project of its own.
    const wt = worktreeParent(f.path)
    const path = wt && existsSync(wt.parent) ? wt.parent : f.path
    const norm = normalizePath(path)
    const p = byPath.get(norm) ?? blank(path, false)
    p.keys.push(f.key)
    // Two keys can resolve to the same folder; the more recently used one is the main key.
    if (!wt && (!p.key || f.lastActivity > p.lastActivity)) p.key = f.key
    p.sessionCount += f.sessionCount
    p.lastActivity = Math.max(p.lastActivity, f.lastActivity)
    byPath.set(norm, p)
  }
  await matchStrayChats(found, byPath, store, blank)
  // A project whose chats all ran in worktrees has no folder of its own yet; use the name Claude Code would give it.
  for (const p of byPath.values()) if (!p.key) p.key = encodeProjectKey(p.path)

  for (const path of store.manualProjects) {
    const norm = normalizePath(path)
    if (!byPath.has(norm)) byPath.set(norm, blank(path, true))
  }

  const list = [...byPath.values()].filter((p) => p.manual || existsSync(p.path) || p.sessionCount > 0)
  await Promise.all(list.map(async (p) => Object.assign(p, await describe(p.path, p.meta))))
  return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivity - a.lastActivity)
}

/**
 * Chats started in a parent folder (C:\, home, Desktop) usually spend their time in one project.
 * Those are shown under that project, which is created if it has no chats of its own (like a project
 * you only ever reached with "cd"). Your own choices (Move to project) win over the automatic match.
 */
async function matchStrayChats(
  found: { key: string; path: string; chats: { id: string; mtime: number }[] }[],
  byPath: Map<string, Project>,
  store: StoreData,
  blank: (path: string, manual: boolean) => Project
): Promise<void> {
  const next = new Map<string, { path: string; key: string; from: string; byYou: boolean }>()
  const home = homedir()
  const rootOf = (folder: string) => projectRootOf(folder, home, hasMarker)
  const strays = found.filter((f) => {
    const root = rootOf(f.path)
    return !worktreeParent(f.path) && (!root || normalizePath(root) !== normalizePath(f.path))
  })
  // Ask the index only about chats that changed since last time. While it's busy (a full rebuild
  // can take minutes) don't wait: list projects now, and the next refresh picks the matches up.
  const chats = strays.flatMap((f) => f.chats)
  const stale = chats.filter((c) => folderCache.get(c.id)?.mtime !== c.mtime)
  if (stale.length) {
    try {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 1500))
      const fresh = await Promise.race([folderSource(stale.map((c) => c.id)), timeout])
      if (fresh) for (const c of stale) if (fresh[c.id]?.length) folderCache.set(c.id, { mtime: c.mtime, folders: fresh[c.id] })
    } catch {
      /* index not ready yet: only your own moves and earlier matches apply */
    }
  }
  const folders = Object.fromEntries(chats.map((c) => [c.id, folderCache.get(c.id)?.folders ?? []]))
  const own = store.chatProjects
  for (const f of found) {
    for (const c of f.chats) {
      const mine = own[c.id]
      const target = mine ?? (strays.includes(f) ? pickProject(folders[c.id] ?? [], f.path, rootOf) : null)
      if (!target || normalizePath(target) === normalizePath(f.path) || !existsSync(target)) continue
      next.set(c.id, { path: target, key: f.key, from: f.path, byYou: !!mine })
      const fromProject = byPath.get(normalizePath(worktreeParent(f.path)?.parent ?? f.path))
      if (fromProject) fromProject.sessionCount--
      const norm = normalizePath(target)
      const to = byPath.get(norm) ?? blank(target, false)
      to.sessionCount++
      to.lastActivity = Math.max(to.lastActivity, c.mtime)
      byPath.set(norm, to)
    }
  }
  movedChats = next
}

function metaFor(store: StoreData, path: string): ProjectMeta {
  const m = store.projectMeta[normalizePath(path)] as ProjectMeta | undefined
  return { ...m, tags: m?.tags ?? [], notes: m?.notes ?? '' }
}

export function setProjectMeta(path: string, patch: Partial<ProjectMeta>): void {
  updateStore((s) => {
    const key = normalizePath(path)
    const cur = s.projectMeta[key] as ProjectMeta | undefined
    const next: ProjectMeta = { ...cur, ...patch, tags: patch.tags ?? cur?.tags ?? [], notes: patch.notes ?? cur?.notes ?? '' }
    next.tags = [...new Set(next.tags.map((t) => t.trim()).filter(Boolean))]
    if (!next.group?.trim()) delete next.group
    else next.group = next.group.trim()
    if (!next.status) delete next.status
    if (!next.displayName?.trim()) delete next.displayName
    else next.displayName = next.displayName.trim().slice(0, 60)
    if (next.icon == null) delete next.icon
    if (next.hue == null) delete next.hue
    if (!next.defaultModel) delete next.defaultModel
    if (next.mcpAllow == null) delete next.mcpAllow
    s.projectMeta[key] = next
  })
}

/** The most recently updated sessions across all projects, for the Home view. */
export async function recentSessions(limit: number): Promise<RecentSession[]> {
  const projects = (await listProjects()).filter((p) => p.sessionCount > 0 && !p.worktree)
  // Only the most active projects can contain the newest sessions.
  const candidates = projects.sort((a, b) => b.lastActivity - a.lastActivity).slice(0, limit)
  const lists = await Promise.all(
    candidates.map(async (p) =>
      (await listSessions(p.keys, p.path)).slice(0, limit).map((s) => ({ ...s, projectName: p.name, projectPath: p.path }))
    )
  )
  return lists
    .flat()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

/** True when some project folder has a transcript for this session (a session with no prompts has none). */
export async function sessionExists(sessionId: string): Promise<boolean> {
  if (!/^[\w-]+$/.test(sessionId)) return false
  try {
    const keys = await fs.readdir(claudeProjectsDir)
    return keys.some((key) => existsSync(join(claudeProjectsDir, key, `${sessionId}.jsonl`)))
  } catch {
    return false
  }
}

export async function getSession(projectKey: string, sessionId: string): Promise<SessionDetail> {
  const file = join(claudeProjectsDir, projectKey, `${sessionId}.jsonl`)
  const summary = await summarizeSession(projectKey, file)
  const messages: ChatMessage[] = []

  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.isSidechain || entry.isMeta) continue
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (entry.type === 'user' && !isHumanPrompt(entry)) continue
    const text = messageText(entry).trim()
    if (!text) continue
    const role = entry.type as ChatMessage['role']
    const last = messages[messages.length - 1]
    // Assistant replies are streamed as several entries; join consecutive ones.
    if (last && last.role === 'assistant' && role === 'assistant') {
      last.text += '\n\n' + text
    } else {
      messages.push({ role, text, timestamp: ts(entry.timestamp) })
    }
  }

  const truncated = messages.length > MAX_MESSAGES
  return { summary, messages: truncated ? messages.slice(-MAX_MESSAGES) : messages, truncated }
}
