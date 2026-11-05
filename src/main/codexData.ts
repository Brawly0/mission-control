import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ChatMessage, CodexUsage, RateLimitInfo, SessionDetail, SessionRecap, SessionSummary } from '../shared/types'
import { codexIdFromFile, codexLimits, codexPrompt, codexRecapBuilder, codexReply, codexTotals, type CodexTokens } from '../shared/codex'
import { prettyWorktreeName, titleFromPrompt, worktreeParent } from '../shared/projectLook'
import { whichSync } from './pty'

/**
 * Codex CLI chats, read from ~/.codex (or $CODEX_HOME) the way claudeData.ts reads ~/.claude:
 * read-only, never written (ADR 0020). Session files can grow large, so listings read only the
 * head (session meta, first prompt) and the tail (latest prompt, token totals, plan limits).
 */

export const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
const sessionsRoot = join(codexHome, 'sessions')

const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 128 * 1024
const MAX_MESSAGES = 600

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** What a listing knows about one Codex chat. */
interface CodexChat {
  file: string
  summary: SessionSummary
  totals: CodexTokens | null
  limits: RateLimitInfo | null
  model: string
}

const chatCache = new Map<string, { size: number; mtime: number; chat: CodexChat }>()
const fileById = new Map<string, string>()

let codexPath: string | null | undefined
export function codexInstalled(): boolean {
  if (codexPath === undefined) codexPath = whichSync('codex')
  return !!codexPath
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

/** Every rollout file, newest folder first: sessions/YYYY/MM/DD/rollout-…jsonl. */
async function rolloutFiles(): Promise<string[]> {
  const out: string[] = []
  const sub = async (dir: string) => (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => /^\d+$/.test(n)).sort().reverse()
  for (const y of await sub(sessionsRoot))
    for (const m of await sub(join(sessionsRoot, y)))
      for (const d of await sub(join(sessionsRoot, y, m))) {
        const dir = join(sessionsRoot, y, m, d)
        for (const n of await fs.readdir(dir).catch(() => [] as string[])) if (n.endsWith('.jsonl') && codexIdFromFile(n)) out.push(join(dir, n))
      }
  return out
}

/** Codex's own chat names (session_index.jsonl: one line per rename, newest last). */
let titleCache: { mtime: number; titles: Map<string, string> } | null = null
async function codexTitles(): Promise<Map<string, string>> {
  const file = join(codexHome, 'session_index.jsonl')
  try {
    const st = await fs.stat(file)
    if (titleCache?.mtime === st.mtimeMs) return titleCache.titles
    const titles = new Map<string, string>()
    for (const e of parseLines(await fs.readFile(file, 'utf8'), false, false)) if (e?.id && e.thread_name) titles.set(String(e.id).toLowerCase(), String(e.thread_name))
    titleCache = { mtime: st.mtimeMs, titles }
    return titles
  } catch {
    return new Map()
  }
}

async function readChat(file: string, titles: Map<string, string>): Promise<CodexChat | null> {
  const st = await fs.stat(file)
  const id = codexIdFromFile(basename(file))!
  const hit = chatCache.get(file)
  const title = titles.get(id)
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) {
    // The name can arrive after the file last changed.
    if (title && hit.chat.summary.title !== title) hit.chat.summary = { ...hit.chat.summary, title, titleSource: 'claude-code' }
    return hit.chat
  }
  const headLen = Math.min(st.size, HEAD_BYTES)
  const head = parseLines(await readRange(file, 0, headLen), false, headLen < st.size)
  const tailStart = Math.max(headLen, st.size - TAIL_BYTES)
  const tail = tailStart < st.size ? parseLines(await readRange(file, tailStart, st.size - tailStart), true, false) : []
  const meta = head.find((e) => e?.type === 'session_meta')?.payload
  if (!meta) return null
  const all = [...head, ...tail]
  const newestFirst = [...all].reverse()
  const firstPrompt = all.map(codexPrompt).find(Boolean) ?? ''
  const lastPrompt = newestFirst.map(codexPrompt).find(Boolean) ?? ''
  const cwd = typeof meta.cwd === 'string' ? meta.cwd : ''
  const wt = worktreeParent(cwd)
  const started = Date.parse(meta.timestamp ?? '') || st.birthtimeMs
  const summary: SessionSummary = {
    id,
    projectKey: 'codex',
    tool: 'codex',
    title: title || titleFromPrompt(firstPrompt) || '(empty Codex chat)',
    titleSource: title ? 'claude-code' : 'prompt',
    firstPrompt: firstPrompt.slice(0, 500),
    lastPrompt: lastPrompt && lastPrompt !== firstPrompt ? lastPrompt.slice(0, 300) : undefined,
    cwd,
    gitBranch: typeof meta.git?.branch === 'string' && meta.git.branch !== 'HEAD' ? meta.git.branch : '',
    worktree: wt ? prettyWorktreeName(wt.name) : undefined,
    startedAt: started,
    updatedAt: st.mtimeMs,
    sizeBytes: st.size
  }
  // Totals are running counts, so only the newest one is right. If the tail holds none but the file has
  // an unread middle, the head's would be an older, smaller count: read the whole file instead (rare).
  let totals = newestFirst.map(codexTotals).find(Boolean) ?? null
  if (st.size > headLen && !tail.some((e) => codexTotals(e))) {
    const whole = parseLines(await readRange(file, 0, st.size), false, false)
    totals = [...whole].reverse().map(codexTotals).find(Boolean) ?? totals
  }
  const chat: CodexChat = {
    file,
    summary,
    totals,
    limits: newestFirst.map(codexLimits).find(Boolean) ?? null,
    model: newestFirst.find((e) => e?.type === 'turn_context' && e.payload?.model)?.payload.model ?? ''
  }
  chatCache.set(file, { size: st.size, mtime: st.mtimeMs, chat })
  fileById.set(id, file)
  return chat
}

/** Every Codex chat on this computer, newest first. Exec runs Mission Control didn't start count too. */
async function allChats(): Promise<CodexChat[]> {
  const [files, titles] = await Promise.all([rolloutFiles(), codexTitles()])
  const results = await Promise.allSettled(files.map((f) => readChat(f, titles)))
  return results
    .flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))
    .sort((a, b) => b.summary.updatedAt - a.summary.updatedAt)
}

/** Codex chats that ran in a project folder or one of its worktrees (<project>\.claude\worktrees\…). */
export async function codexSessionsFor(projectPath: string): Promise<SessionSummary[]> {
  const here = norm(projectPath)
  if (!here) return []
  return (await allChats())
    .filter((c) => {
      const cwd = norm(c.summary.cwd)
      return cwd === here || cwd.startsWith(here + '\\.claude\\worktrees\\')
    })
    .map((c) => c.summary)
}

export async function codexFileFor(id: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(id)) return null
  const hit = fileById.get(id.toLowerCase())
  if (hit && existsSync(hit)) return hit
  for (const f of await rolloutFiles()) {
    const fid = codexIdFromFile(basename(f))
    if (fid) fileById.set(fid, f)
    if (fid === id.toLowerCase()) return f
  }
  return null
}

/** One Codex chat's listing entry (head and tail only), or null when there's no such chat. */
export async function codexSummary(id: string): Promise<SessionSummary | null> {
  const file = await codexFileFor(id)
  return file ? ((await readChat(file, await codexTitles()))?.summary ?? null) : null
}

async function* entries(file: string): AsyncGenerator<any> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    try {
      yield JSON.parse(line)
    } catch {
      /* partial line */
    }
  }
}

/** The chat as prompts and replies, for the chat viewer and handoffs. */
export async function getCodexSession(id: string): Promise<SessionDetail> {
  const file = await codexFileFor(id)
  if (!file) throw new Error('This Codex chat has no session file (yet).')
  const summary = (await readChat(file, await codexTitles()))?.summary
  if (!summary) throw new Error('This Codex session file could not be read.')
  const messages: ChatMessage[] = []
  for await (const e of entries(file)) {
    const prompt = codexPrompt(e)
    const reply = prompt ? '' : codexReply(e)
    if (!prompt && !reply) continue
    const role: ChatMessage['role'] = prompt ? 'user' : 'assistant'
    const last = messages[messages.length - 1]
    if (last && role === 'assistant' && last.role === 'assistant') last.text += '\n\n' + reply
    else messages.push({ role, text: prompt || reply, timestamp: Date.parse(e.timestamp ?? '') || 0 })
  }
  const truncated = messages.length > MAX_MESSAGES
  return { summary, messages: truncated ? messages.slice(-MAX_MESSAGES) : messages, truncated }
}

const recapCache = new Map<string, { size: number; mtime: number; recap: SessionRecap }>()

/** "What we worked on" for a Codex chat; one streamed pass, cached until the file changes. */
export async function codexRecap(id: string): Promise<SessionRecap | null> {
  const file = await codexFileFor(id)
  if (!file) return null
  const st = await fs.stat(file)
  const hit = recapCache.get(id)
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.recap
  const b = codexRecapBuilder(id)
  for await (const e of entries(file)) b.add(e)
  const recap = b.done()
  recapCache.set(id, { size: st.size, mtime: st.mtimeMs, recap })
  return recap
}

/**
 * The Codex chat a terminal just started: the newest rollout in `cwd` created since `since` that
 * no other agent has claimed. Codex can't be given a session id up front, so the app looks for it.
 */
export async function findNewCodexSession(cwd: string, since: number, taken: Set<string>): Promise<string | null> {
  const want = norm(cwd)
  const day = (t: number) => {
    const d = new Date(t)
    return join(sessionsRoot, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  }
  for (const dir of [...new Set([day(Date.now()), day(since)])]) {
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl')).sort().reverse()
    for (const n of names) {
      const id = codexIdFromFile(n)
      if (!id || taken.has(id)) continue
      const file = join(dir, n)
      const st = await fs.stat(file).catch(() => null)
      if (!st || st.birthtimeMs < since - 2000) continue
      const meta = parseLines(await readRange(file, 0, Math.min(st.size, HEAD_BYTES)), false, true).find((e) => e?.type === 'session_meta')?.payload
      if (meta && norm(String(meta.cwd ?? '')) === want) {
        fileById.set(id, file)
        return id
      }
    }
  }
  return null
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Codex token use since a time, and its newest plan limits. A chat's tokens count on the day it was
 * last active (Codex files hold running totals, so the tail alone is enough).
 */
export async function codexUsage(since: number): Promise<CodexUsage> {
  const chats = await allChats()
  const limits = chats.map((c) => c.limits).filter((l): l is RateLimitInfo => !!l).sort((a, b) => b.at - a.at)[0] ?? null
  const totals = { input: 0, cachedInput: 0, output: 0, reasoning: 0, sessions: 0 }
  const byDay = new Map<string, CodexUsage['byDay'][number]>()
  const byProject = new Map<string, CodexUsage['byProject'][number]>()
  const byModel = new Map<string, CodexUsage['byModel'][number]>()
  const add = <T extends { input: number; cachedInput: number; output: number; sessions: number }>(map: Map<string, T>, key: string, make: () => T, t: CodexTokens) => {
    const row = map.get(key) ?? make()
    row.input += t.input
    row.cachedInput += t.cachedInput
    row.output += t.output
    row.sessions++
    map.set(key, row)
  }
  for (const c of chats) {
    if (!c.totals || c.summary.updatedAt < since) continue
    const t = c.totals
    totals.input += t.input
    totals.cachedInput += t.cachedInput
    totals.output += t.output
    totals.reasoning += t.reasoning
    totals.sessions++
    const zero = { input: 0, cachedInput: 0, output: 0, sessions: 0 }
    const day = dayKey(c.summary.updatedAt)
    add(byDay, day, () => ({ day, ...zero }), t)
    const parent = worktreeParent(c.summary.cwd)?.parent ?? c.summary.cwd
    add(byProject, norm(parent), () => ({ projectPath: parent, ...zero }), t)
    add(byModel, c.model || 'unknown', () => ({ model: c.model || 'unknown', ...zero }), t)
  }
  const top = <T extends { input: number; output: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.input + b.output - (a.input + a.output))
  return {
    limits,
    totals,
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProject: top(byProject),
    byModel: top(byModel),
    installed: codexInstalled()
  }
}
