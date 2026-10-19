import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ChatMessage, Project, SessionDetail, SessionSummary } from '../shared/types'
import { loadStore } from './store'

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
  const customTitle = [...tail, ...head].reverse().find((e) => e?.type === 'custom-title')?.customTitle
  const firstPrompt = firstPromptEntry ? messageText(firstPromptEntry).trim() : ''
  const startedAt = ts(head.find((e) => e?.timestamp)?.timestamp) || stat.birthtimeMs

  const summary: SessionSummary = {
    id: basename(file, '.jsonl'),
    projectKey,
    title: customTitle || firstPrompt.split('\n')[0].slice(0, 120) || '(empty session)',
    firstPrompt: firstPrompt.slice(0, 500),
    cwd: withCwd?.cwd ?? '',
    gitBranch: withCwd?.gitBranch && withCwd.gitBranch !== 'HEAD' ? withCwd.gitBranch : '',
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

export async function listSessions(projectKey: string): Promise<SessionSummary[]> {
  const files = await sessionFiles(projectKey)
  const results = await Promise.allSettled(files.map((f) => summarizeSession(projectKey, f)))
  return results
    .flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    .sort((a, b) => b.updatedAt - a.updatedAt)
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

  await Promise.all(
    keys.map(async (key) => {
      const files = await sessionFiles(key)
      if (files.length === 0) return
      const stats = await Promise.all(files.map((f) => fs.stat(f).then((s) => ({ f, s }))))
      stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)
      let path = ''
      try {
        path = (await summarizeSession(key, stats[0].f)).cwd
      } catch {
        /* fall through to decoded key */
      }
      if (!path) path = decodeKey(key)
      const project: Project = {
        key,
        path,
        name: basename(path) || path,
        sessionCount: files.length,
        lastActivity: stats[0].s.mtimeMs,
        pinned: pinned.has(normalizePath(path)),
        manual: false,
        worktree: /[\\/]\.claude[\\/]worktrees[\\/]|[\\/]scratch-workspaces[\\/]|[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(path)
      }
      // Two keys can resolve to the same folder; keep the more recently used one.
      const existing = byPath.get(normalizePath(path))
      if (!existing || existing.lastActivity < project.lastActivity) byPath.set(normalizePath(path), project)
    })
  )

  for (const path of store.manualProjects) {
    const norm = normalizePath(path)
    if (byPath.has(norm)) continue
    byPath.set(norm, {
      key: '',
      path,
      name: basename(path) || path,
      sessionCount: 0,
      lastActivity: 0,
      pinned: pinned.has(norm),
      manual: true,
      worktree: false
    })
  }

  return [...byPath.values()]
    .filter((p) => p.manual || existsSync(p.path) || p.sessionCount > 0)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivity - a.lastActivity)
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
