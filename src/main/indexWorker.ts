/**
 * Background indexer (worker thread). Reads Claude Code's session files and keeps a SQLite database
 * in the app's data folder with:
 *   - fts:      full-text index of human prompts and Claude's text replies
 *   - msgs:     one row per assistant API message with its token usage and estimated cost
 *   - sessions: title, project and dates per session
 *   - files:    how far each .jsonl has been read, so appended lines are indexed incrementally
 *   - plan_readings: plan-limit readings over time (Mission Control's own data, kept across schema changes)
 * Claude Code's files are only read, never written.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { costOf } from './pricing'
import { titleFromPrompt, windowsPath } from '../shared/projectLook'
import { skillUsesIn } from '../shared/skills'
import { CALIBRATION_DAYS, calibrate, modelPrices, type CostPoint, type PlanReading } from '../shared/planCost'
import type { IndexStatus, SearchHit, UsageReport, UsageTotals } from '../shared/types'

const { dbPath, projectsDir } = workerData as { dbPath: string; projectsDir: string }
const SCHEMA_VERSION = 8
const MAX_BODY = 20_000

function openDb(): DatabaseSync {
  const d = new DatabaseSync(dbPath)
  // Another copy that is still shutting down may hold the file for a moment: wait instead of failing.
  d.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  // A damaged file (e.g. a crash or another copy of the app writing at the same time) is rebuilt from scratch.
  const check = (d.prepare('PRAGMA quick_check(1)').get() as Record<string, string> | undefined) ?? {}
  if (Object.values(check)[0] !== 'ok') {
    d.close()
    throw new Error('database disk image is malformed')
  }
  d.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)')
  const version = (d.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined)?.value
  if (Number(version) !== SCHEMA_VERSION) {
    d.exec('DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS msgs; DROP TABLE IF EXISTS fts; DROP TABLE IF EXISTS folders; DROP TABLE IF EXISTS briefings; DROP TABLE IF EXISTS skill_uses;')
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, session_id TEXT, size INTEGER, mtime REAL, offset INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(
      session_id TEXT PRIMARY KEY, project_key TEXT, project_path TEXT, title TEXT, custom_title TEXT,
      first_prompt TEXT, started INTEGER, updated INTEGER);
    CREATE TABLE IF NOT EXISTS msgs(
      session_id TEXT, msg_id TEXT, model TEXT, day TEXT, ts INTEGER,
      input INTEGER, output INTEGER, cw5 INTEGER, cw1h INTEGER, cread INTEGER, cost REAL,
      PRIMARY KEY(session_id, msg_id));
    CREATE INDEX IF NOT EXISTS msgs_ts ON msgs(ts);
    CREATE TABLE IF NOT EXISTS briefings(
      session_id TEXT, ts INTEGER, trigger TEXT, pre_tokens INTEGER, text TEXT, PRIMARY KEY(session_id, ts));
    CREATE TABLE IF NOT EXISTS skill_uses(
      session_id TEXT, use_id TEXT, ts INTEGER, skill TEXT, how TEXT, PRIMARY KEY(session_id, use_id));
    CREATE INDEX IF NOT EXISTS skill_uses_ts ON skill_uses(ts);
    CREATE TABLE IF NOT EXISTS folders(
      session_id TEXT, folder_lc TEXT, folder TEXT, hits INTEGER, PRIMARY KEY(session_id, folder_lc));
    CREATE TABLE IF NOT EXISTS plan_readings(win TEXT, ts INTEGER, resets_at INTEGER, util REAL, PRIMARY KEY(win, ts));
    CREATE INDEX IF NOT EXISTS plan_readings_ts ON plan_readings(ts);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
      body, session_id UNINDEXED, role UNINDEXED, ts UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
  `)
  d.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION))
  return d
}

function statements(d: DatabaseSync) {
  return {
    getFile: d.prepare('SELECT size, mtime, offset FROM files WHERE path = ?'),
    putFile: d.prepare('INSERT OR REPLACE INTO files(path, session_id, size, mtime, offset) VALUES (?, ?, ?, ?, ?)'),
    getSession: d.prepare('SELECT * FROM sessions WHERE session_id = ?'),
    putSession: d.prepare(
      `INSERT OR REPLACE INTO sessions(session_id, project_key, project_path, title, custom_title, first_prompt, started, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    getMsg: d.prepare('SELECT input, output, cw5, cw1h, cread FROM msgs WHERE session_id = ? AND msg_id = ?'),
    putMsg: d.prepare(
      `INSERT OR REPLACE INTO msgs(session_id, msg_id, model, day, ts, input, output, cw5, cw1h, cread, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    addFts: d.prepare('INSERT INTO fts(body, session_id, role, ts) VALUES (?, ?, ?, ?)'),
    dropFts: d.prepare('DELETE FROM fts WHERE session_id = ?'),
    dropMsgs: d.prepare('DELETE FROM msgs WHERE session_id = ?'),
    dropFiles: d.prepare('DELETE FROM files WHERE session_id = ?'),
    dropFolders: d.prepare('DELETE FROM folders WHERE session_id = ?'),
    dropBriefings: d.prepare('DELETE FROM briefings WHERE session_id = ?'),
    dropSkillUses: d.prepare('DELETE FROM skill_uses WHERE session_id = ?'),
    addSkillUse: d.prepare('INSERT OR IGNORE INTO skill_uses(session_id, use_id, ts, skill, how) VALUES (?, ?, ?, ?, ?)'),
    addBriefing: d.prepare('INSERT OR REPLACE INTO briefings(session_id, ts, trigger, pre_tokens, text) VALUES (?, ?, ?, ?, ?)'),
    addFolder: d.prepare(
      `INSERT INTO folders(session_id, folder_lc, folder, hits) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, folder_lc) DO UPDATE SET hits = hits + excluded.hits`
    )
  }
}

/** True for SQLite errors that mean the file itself is broken, not just one bad query. */
function isCorrupt(err: unknown): boolean {
  return /malformed|not a database|corrupt|SQLITE_CORRUPT|SQLITE_NOTADB/i.test((err as Error)?.message ?? '')
}

/** Deletes the index file and starts an empty one; everything is re-read from Claude Code's files. */
function resetDb(): void {
  try {
    db?.close()
  } catch {
    /* already closed or broken */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix)
    } catch {
      /* in use; opening below will report it */
    }
  }
  db = openDb()
  q = statements(db)
}

let db: DatabaseSync
let q: ReturnType<typeof statements>
try {
  db = openDb()
  q = statements(db)
} catch {
  resetDb()
}

// ---------------------------------------------------------------- parsing

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

function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface SessionRow {
  session_id: string
  project_key: string
  project_path: string
  title: string
  custom_title: string
  first_prompt: string
  started: number
  updated: number
}

/** Reads complete lines from `offset` to the end of the file; returns the new offset. */
function readLines(file: string, offset: number, onLine: (line: string) => void): number {
  const fd = openSync(file, 'r')
  try {
    const chunk = Buffer.alloc(1024 * 1024)
    let carry = Buffer.alloc(0)
    let pos = offset
    let consumed = offset
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, pos)
      if (n <= 0) break
      pos += n
      const buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n)
      let start = 0
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0x0a) continue
        const line = buf.toString('utf8', start, i).trim()
        if (line) onLine(line)
        start = i + 1
      }
      carry = Buffer.from(buf.subarray(start))
      consumed = pos - carry.length
    }
    // A last line without a newline may still be being written; read it next time.
    return consumed
  } finally {
    closeSync(fd)
  }
}

/**
 * Indexes one transcript from its stored offset. `main` transcripts feed search and titles;
 * subagent transcripts only add token usage to their parent session.
 */
function indexFile(file: string, projectKey: string, sessionId: string, main: boolean): void {
  const st = statSync(file)
  const prev = q.getFile.get(file) as { size: number; mtime: number; offset: number } | undefined
  if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) return

  let offset = prev?.offset ?? 0
  if (prev && st.size < prev.offset) {
    // The file was rewritten, not appended to: start this session over.
    offset = 0
    if (main) {
      q.dropFts.run(sessionId)
      q.dropMsgs.run(sessionId)
      q.dropFiles.run(sessionId)
      q.dropFolders.run(sessionId)
      q.dropBriefings.run(sessionId)
      q.dropSkillUses.run(sessionId)
    }
  }

  const existing = q.getSession.get(sessionId) as SessionRow | undefined
  const row: SessionRow = existing ?? {
    session_id: sessionId,
    project_key: projectKey,
    project_path: '',
    title: '',
    custom_title: '',
    first_prompt: '',
    started: 0,
    updated: 0
  }

  // Which folders this chat worked in: its working folder on every line, plus files its tools touched.
  const folders = new Map<string, { folder: string; hits: number }>()
  const hit = (raw: unknown, isFile: boolean) => {
    if (typeof raw !== 'string') return
    let p = windowsPath(raw)
    if (!p) return
    if (isFile) p = p.replace(/\\[^\\]*$/, '') || p
    const key = p.toLowerCase()
    const cur = folders.get(key)
    if (cur) cur.hits++
    else folders.set(key, { folder: p, hits: 1 })
  }

  let boundary: { trigger?: string; preTokens?: number } | null = null

  db.exec('BEGIN')
  try {
    const newOffset = readLines(file, offset, (line) => {
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        return
      }
      const ts = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) || 0 : 0
      if (main) {
        if (!row.project_path && typeof e.cwd === 'string') row.project_path = e.cwd
        if (!e.isSidechain) hit(e.cwd, false)
        // When a chat runs out of room, Claude Code writes a summary to carry on with: a session briefing.
        if (e.type === 'system' && e.subtype === 'compact_boundary') boundary = e.compactMetadata ?? {}
        if (e.type === 'user' && e.isCompactSummary) {
          const text = messageText(e)
          if (text) q.addBriefing.run(sessionId, ts || st.mtimeMs, String(boundary?.trigger ?? ''), Number(boundary?.preTokens ?? 0), text)
          boundary = null
        }
        for (const use of skillUsesIn(e)) q.addSkillUse.run(sessionId, use.id, ts || st.mtimeMs, use.skill, use.how)
        if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
          for (const b of e.message.content) {
            if (b?.type !== 'tool_use' || !b.input) continue
            hit(b.input.file_path ?? b.input.notebook_path, true)
            hit(b.input.path, false)
          }
        }
        if (ts && (!row.started || ts < row.started)) row.started = ts
        if (e.type === 'custom-title' && typeof e.customTitle === 'string') row.custom_title = e.customTitle
        // Claude Code's automatic chat names; a title set with /rename replaces them.
        if (e.type === 'ai-title' && typeof e.aiTitle === 'string' && !row.custom_title) row.custom_title = e.aiTitle
        if (e.type === 'agent-name' && typeof e.agentName === 'string' && !row.custom_title) row.custom_title = e.agentName
      }

      if (e.type === 'assistant' && e.message?.usage && e.message?.id && e.message.model !== '<synthetic>') {
        // Streamed replies repeat the same message id on several lines; keep the largest counts.
        const u = e.message.usage
        const cc = u.cache_creation
        const total5m = cc ? Number(cc.ephemeral_5m_input_tokens ?? 0) : Number(u.cache_creation_input_tokens ?? 0)
        const total1h = cc ? Number(cc.ephemeral_1h_input_tokens ?? 0) : 0
        const old = q.getMsg.get(sessionId, e.message.id) as { input: number; output: number; cw5: number; cw1h: number; cread: number } | undefined
        const m = {
          input: Math.max(Number(u.input_tokens ?? 0), old?.input ?? 0),
          output: Math.max(Number(u.output_tokens ?? 0), old?.output ?? 0),
          cw5: Math.max(total5m, old?.cw5 ?? 0),
          cw1h: Math.max(total1h, old?.cw1h ?? 0),
          cread: Math.max(Number(u.cache_read_input_tokens ?? 0), old?.cread ?? 0)
        }
        const model = String(e.message.model ?? 'unknown')
        const cost = costOf(model, { input: m.input, output: m.output, cacheWrite5m: m.cw5, cacheWrite1h: m.cw1h, cacheRead: m.cread })
        const when = ts || st.mtimeMs
        q.putMsg.run(sessionId, e.message.id, model, localDay(when), when, m.input, m.output, m.cw5, m.cw1h, m.cread, cost)
      }

      if (!main || e.isSidechain || e.isMeta) return
      if (e.type !== 'user' && e.type !== 'assistant') return
      const text = messageText(e).trim()
      if (!text || (e.type === 'user' && text.startsWith('<'))) return
      if (e.type === 'user' && !row.first_prompt) row.first_prompt = text.slice(0, 300)
      q.addFts.run(text.slice(0, MAX_BODY), sessionId, e.type, ts)
    })

    if (main) {
      const titleFile = join(projectsDir, projectKey, sessionId, 'custom-title.json')
      if (existsSync(titleFile)) {
        try {
          row.custom_title = JSON.parse(readFileSync(titleFile, 'utf8')).customTitle || row.custom_title
        } catch {
          /* unreadable title file */
        }
      }
      row.title = row.custom_title || titleFromPrompt(row.first_prompt) || '(empty session)'
      row.updated = Math.max(row.updated, st.mtimeMs)
      q.putSession.run(row.session_id, row.project_key, row.project_path, row.title, row.custom_title, row.first_prompt, row.started, row.updated)
    }
    for (const [key, v] of folders) q.addFolder.run(sessionId, key, v.folder, v.hits)
    q.putFile.run(file, sessionId, st.size, st.mtimeMs, newOffset)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// ---------------------------------------------------------------- run loop

let status: IndexStatus = { indexing: false, done: 0, total: 0, sessions: 0, messages: 0, lastRun: 0 }

function postStatus(patch: Partial<IndexStatus>) {
  status = { ...status, ...patch }
  parentPort!.postMessage({ type: 'status', status })
}

function counts() {
  const s = db.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }
  const m = db.prepare('SELECT COUNT(*) n FROM fts').get() as { n: number }
  return { sessions: s.n, messages: m.n }
}

async function run() {
  if (status.indexing) return
  const jobs: { file: string; key: string; session: string; main: boolean }[] = []
  let keys: string[] = []
  try {
    keys = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    /* no Claude Code data yet */
  }
  for (const key of keys) {
    const dir = join(projectsDir, key)
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue
      const session = basename(name, '.jsonl')
      jobs.push({ file: join(dir, name), key, session, main: true })
      const subDir = join(dir, session, 'subagents')
      if (existsSync(subDir)) {
        for (const sub of readdirSync(subDir)) {
          if (sub.endsWith('.jsonl')) jobs.push({ file: join(subDir, sub), key, session, main: false })
        }
      }
    }
  }

  // Only files that changed since the last run need work.
  const pending = jobs.filter((j) => {
    const prev = q.getFile.get(j.file) as { size: number; mtime: number } | undefined
    if (!prev) return true
    try {
      const st = statSync(j.file)
      return st.size !== prev.size || st.mtimeMs !== prev.mtime
    } catch {
      return false
    }
  })
  // Main transcripts first, so a subagent's parent session row exists.
  pending.sort((a, b) => Number(b.main) - Number(a.main))

  if (pending.length === 0) {
    postStatus({ lastRun: Date.now() })
    return
  }
  postStatus({ indexing: true, done: 0, total: pending.length, error: undefined })
  let lastPost = Date.now()
  for (let i = 0; i < pending.length; i++) {
    const j = pending[i]
    try {
      indexFile(j.file, j.key, j.session, j.main)
    } catch (err) {
      if (isCorrupt(err)) {
        // Start over on a fresh file; the next run re-reads every chat.
        resetDb()
        postStatus({ indexing: false, error: undefined, lastRun: 0, ...counts() })
        setImmediate(() => void run().catch(() => undefined))
        return
      }
      status.error = `${basename(j.file)}: ${(err as Error).message}`
    }
    if (Date.now() - lastPost > 300) {
      lastPost = Date.now()
      postStatus({ done: i + 1, ...counts() })
    }
    // Let queued searches run between files.
    await new Promise((r) => setImmediate(r))
  }
  postStatus({ indexing: false, done: pending.length, lastRun: Date.now(), ...counts() })
}

// ---------------------------------------------------------------- queries

/** Turns user input into a safe FTS5 query: every word must match, last word as a prefix. */
function ftsQuery(input: string): string {
  const words = input.match(/[\p{L}\p{N}_]+/gu) ?? []
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? '*' : ''}`).join(' ')
}

/** SQL for "in one of these project folders", e.g. a project and its worktrees. */
function keyFilter(keys: string | string[], params: (string | number)[]): string {
  const list = Array.isArray(keys) ? keys : [keys]
  params.push(...list)
  return `s.project_key IN (${list.map(() => '?').join(', ')})`
}

function search(query: string, opts: { projectKey?: string | string[]; role?: string; limit?: number }): SearchHit[] {
  const match = ftsQuery(query)
  if (!match) return []
  const where = ['fts MATCH ?']
  const params: (string | number)[] = [match]
  if (opts.role) {
    where.push('fts.role = ?')
    params.push(opts.role)
  }
  if (opts.projectKey?.length) where.push(keyFilter(opts.projectKey, params))
  params.push(Math.min(opts.limit ?? 120, 400))
  const rows = db
    .prepare(
      `SELECT fts.session_id, fts.role, fts.ts, snippet(fts, 0, char(1), char(2), '…', 18) AS snip,
              s.project_key, s.project_path, s.title
       FROM fts JOIN sessions s ON s.session_id = fts.session_id
       WHERE ${where.join(' AND ')}
       ORDER BY bm25(fts) LIMIT ?`
    )
    .all(...params) as any[]
  return rows.map((r) => ({
    sessionId: r.session_id,
    projectKey: r.project_key,
    projectPath: r.project_path,
    title: r.title,
    role: r.role,
    snippet: r.snip,
    timestamp: Number(r.ts) || 0
  }))
}

/** Token and cost sums over msgs; `t` is the table alias prefix ("" or "m."). */
const sums = (t = "") =>
  `SUM(${t}input) input, SUM(${t}output) output, SUM(${t}cw5 + ${t}cw1h) cacheWrite, SUM(${t}cread) cacheRead, SUM(${t}cost) cost`
const SUMS = sums()

function totals(r: any): UsageTotals {
  return {
    input: r?.input ?? 0,
    output: r?.output ?? 0,
    cacheWrite: r?.cacheWrite ?? 0,
    cacheRead: r?.cacheRead ?? 0,
    cost: r?.cost ?? 0,
    sessions: r?.sessions
  }
}

function usageReport(since: number): UsageReport {
  const t = db.prepare(`SELECT ${SUMS}, COUNT(DISTINCT session_id) sessions FROM msgs WHERE ts >= ?`).get(since)
  const byDay = db.prepare(`SELECT day, ${SUMS} FROM msgs WHERE ts >= ? GROUP BY day ORDER BY day`).all(since) as any[]
  const byProject = db
    .prepare(
      `SELECT s.project_key, s.project_path, ${sums('m.')}, COUNT(DISTINCT m.session_id) sessions
       FROM msgs m JOIN sessions s ON s.session_id = m.session_id
       WHERE m.ts >= ? GROUP BY s.project_key ORDER BY cost DESC`
    )
    .all(since) as any[]
  const byModel = db.prepare(`SELECT model, ${SUMS} FROM msgs WHERE ts >= ? GROUP BY model ORDER BY cost DESC`).all(since) as any[]
  const top = db
    .prepare(
      `SELECT m.session_id, s.project_key, s.project_path, s.title, s.updated, ${sums('m.')}
       FROM msgs m JOIN sessions s ON s.session_id = m.session_id
       WHERE m.ts >= ? GROUP BY m.session_id ORDER BY cost DESC LIMIT 10`
    )
    .all(since) as any[]
  return {
    since,
    totals: totals(t),
    byDay: byDay.map((r) => ({ day: r.day, ...totals(r) })),
    byProject: byProject.map((r) => ({ projectKey: r.project_key, projectPath: r.project_path, ...totals(r) })),
    byModel: byModel.map((r) => ({ model: r.model, ...totals(r) })),
    topSessions: top.map((r) => ({
      sessionId: r.session_id,
      projectKey: r.project_key,
      projectPath: r.project_path,
      title: r.title,
      updated: r.updated,
      ...totals(r)
    }))
  }
}

/** Context size of the first reply in a project's most recent chats: what a new chat carries before you type. */
function firstReplies(keys: string[], limit = 12): { tokens: number; model: string }[] {
  if (!keys.length) return []
  const params: (string | number)[] = []
  const filter = keyFilter(keys, params)
  return (
    db
      .prepare(
        `SELECT m.model, (m.input + m.cw5 + m.cw1h + m.cread) AS tokens
         FROM msgs m JOIN sessions s ON s.session_id = m.session_id
         WHERE ${filter} AND m.ts = (SELECT MIN(ts) FROM msgs m2 WHERE m2.session_id = m.session_id)
         ORDER BY m.ts DESC LIMIT ?`
      )
      .all(...params, limit) as { tokens: number; model: string }[]
  ).filter((r) => r.tokens > 0)
}

/** Chats whose estimated cost since a time is at least `usd`, most expensive first. */
function chatsOverCost(since: number, usd: number): { sessionId: string; title: string; projectPath: string; cost: number }[] {
  return (
    db
      .prepare(
        `SELECT m.session_id, s.title, s.project_path, SUM(m.cost) AS cost
         FROM msgs m JOIN sessions s ON s.session_id = m.session_id
         WHERE m.ts >= ? GROUP BY m.session_id HAVING cost >= ? ORDER BY cost DESC LIMIT 20`
      )
      .all(since, usd) as any[]
  ).map((r) => ({ sessionId: r.session_id, title: r.title, projectPath: r.project_path, cost: r.cost }))
}

/** Compaction summaries (session briefings), newest first, with their chat's title and folder. */
function briefings(since = 0, limit = 200): unknown[] {
  return (
    db
      .prepare(
        `SELECT b.session_id, b.ts, b.trigger, b.pre_tokens, b.text, s.title, s.project_key, s.project_path
         FROM briefings b LEFT JOIN sessions s ON s.session_id = b.session_id
         WHERE b.ts >= ? ORDER BY b.ts DESC LIMIT ?`
      )
      .all(since, limit) as any[]
  ).map((r) => ({
    sessionId: r.session_id,
    at: r.ts,
    trigger: r.trigger,
    preTokens: r.pre_tokens,
    text: r.text,
    title: r.title ?? '',
    projectKey: r.project_key ?? '',
    projectPath: r.project_path ?? ''
  }))
}

/** How often each skill was used since a time: by Claude (the Skill tool) and by you (/name). */
function skillUsage(since = 0): unknown[] {
  return (
    db
      .prepare(
        `SELECT skill, COUNT(*) AS uses, SUM(how = 'claude') AS by_claude, SUM(how = 'you') AS by_you,
                COUNT(DISTINCT session_id) AS chats, MAX(ts) AS last
         FROM skill_uses WHERE ts >= ? GROUP BY skill ORDER BY uses DESC`
      )
      .all(since) as any[]
  ).map((r) => ({ skill: r.skill, uses: r.uses, byClaude: r.by_claude, byYou: r.by_you, chats: r.chats, lastUsed: r.last }))
}

/** Usage totals per chat since a time, for moving a chat's usage to the project it's shown under. */
function sessionTotals(since: number, sessionIds: string[]): unknown[] {
  if (!sessionIds.length) return []
  const rows = db
    .prepare(
      `SELECT m.session_id, s.project_key, s.project_path, ${sums('m.')}
       FROM msgs m JOIN sessions s ON s.session_id = m.session_id
       WHERE m.ts >= ? AND m.session_id IN (${sessionIds.map(() => '?').join(', ')}) GROUP BY m.session_id`
    )
    .all(since, ...sessionIds) as any[]
  return rows.map((r) => ({ sessionId: r.session_id, projectKey: r.project_key, projectPath: r.project_path, ...totals(r) }))
}

/** Folders each chat worked in, with how often, for matching chats started from C: to a project. */
function sessionFolders(sessionIds: string[]): Record<string, { folder: string; hits: number }[]> {
  const out: Record<string, { folder: string; hits: number }[]> = {}
  const get = db.prepare('SELECT folder, hits FROM folders WHERE session_id = ? ORDER BY hits DESC LIMIT 200')
  for (const id of sessionIds) out[id] = get.all(id) as { folder: string; hits: number }[]
  return out
}

function sessionUsage(projectKey: string | string[]): Record<string, UsageTotals> {
  const params: string[] = []
  const filter = keyFilter(projectKey, params)
  const rows = db
    .prepare(
      `SELECT m.session_id, ${sums('m.')}
       FROM msgs m JOIN sessions s ON s.session_id = m.session_id
       WHERE ${filter} GROUP BY m.session_id`
    )
    .all(...params) as any[]
  return Object.fromEntries(rows.map((r) => [r.session_id, totals(r)]))
}

// ---------------------------------------------------------------- plan cost and digest

/** Saves one plan reading (every window in it); readings older than 90 days are dropped. */
function addPlanReading(at: number, windows: { name: string; utilization: number; resetsAt: number }[]): void {
  const put = db.prepare('INSERT OR REPLACE INTO plan_readings(win, ts, resets_at, util) VALUES (?, ?, ?, ?)')
  for (const w of windows) put.run(w.name, at, w.resetsAt, w.utilization)
  db.prepare('DELETE FROM plan_readings WHERE ts < ?').run(at - 90 * 86_400_000)
}

/** Removes readings of one window in a time range (the self-test cleans up its sample readings). */
function dropPlanReadings(win: string, from: number, to: number): void {
  db.prepare('DELETE FROM plan_readings WHERE win = ? AND ts >= ? AND ts <= ?').run(win, from, to)
}

function planReadings(since: number): PlanReading[] {
  return (db.prepare('SELECT win, ts, resets_at, util FROM plan_readings WHERE ts >= ? ORDER BY ts').all(since) as any[]).map((r) => ({
    win: r.win,
    ts: r.ts,
    resetsAt: r.resets_at,
    util: r.util
  }))
}

/** Share of each plan window per API-priced dollar over the last two weeks, and prices per model (shared/planCost.ts). */
function planCalibration(now: number): unknown {
  const since = now - CALIBRATION_DAYS * 86_400_000
  const readings = planReadings(since)
  const costs = db.prepare('SELECT ts, cost, model, (input + output + cw5 + cw1h + cread) AS tokens FROM msgs WHERE ts >= ?').all(since) as unknown as CostPoint[]
  const first = db.prepare('SELECT MIN(ts) AS t, COUNT(*) AS n FROM plan_readings').get() as { t: number | null; n: number }
  return { windows: calibrate(readings, costs, now), models: modelPrices(costs), readings: first.n, firstReading: first.t ?? 0 }
}

/** Replies and cost since a time in chats started with Eco mode on, against all other chats. */
function ecoCompare(since: number, ecoIds: string[]): unknown {
  const group = (rows: any[]) => rows.reduce((t, r) => ({ chats: t.chats + 1, replies: t.replies + r.replies, cost: t.cost + r.cost }), { chats: 0, replies: 0, cost: 0 })
  const rows = db.prepare('SELECT session_id, COUNT(*) AS replies, SUM(cost) AS cost FROM msgs WHERE ts >= ? GROUP BY session_id').all(since) as any[]
  const eco = new Set(ecoIds)
  return { since, eco: group(rows.filter((r) => eco.has(r.session_id))), other: group(rows.filter((r) => !eco.has(r.session_id))) }
}

/** One stretch of time in review: chats, replies and cost, the busiest projects and chats, and briefings saved. */
function dayDigest(from: number, to: number): unknown {
  const t = db.prepare('SELECT COUNT(DISTINCT session_id) AS chats, COUNT(*) AS replies, SUM(cost) AS cost FROM msgs WHERE ts >= ? AND ts < ?').get(from, to) as any
  const projects = db
    .prepare(
      `SELECT s.project_path, SUM(m.cost) AS cost, COUNT(DISTINCT m.session_id) AS chats
       FROM msgs m JOIN sessions s ON s.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts < ? GROUP BY s.project_path ORDER BY cost DESC LIMIT 5`
    )
    .all(from, to) as any[]
  const chats = db
    .prepare(
      `SELECT m.session_id, s.title, s.project_path, SUM(m.cost) AS cost
       FROM msgs m JOIN sessions s ON s.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts < ? GROUP BY m.session_id ORDER BY cost DESC LIMIT 5`
    )
    .all(from, to) as any[]
  const b = db.prepare('SELECT COUNT(*) AS n FROM briefings WHERE ts >= ? AND ts < ?').get(from, to) as { n: number }
  return {
    chats: t?.chats ?? 0,
    replies: t?.replies ?? 0,
    costUsd: t?.cost ?? 0,
    topProjects: projects.map((r) => ({ projectPath: r.project_path ?? '', costUsd: r.cost, chats: r.chats })),
    topChats: chats.map((r) => ({ sessionId: r.session_id, title: r.title ?? '', projectPath: r.project_path ?? '', costUsd: r.cost })),
    briefings: b.n
  }
}

// ---------------------------------------------------------------- messages

const handlers: Record<string, (...args: any[]) => unknown> = {
  search,
  usageReport,
  sessionUsage,
  sessionFolders,
  sessionTotals,
  briefings,
  skillUsage,
  firstReplies,
  chatsOverCost,
  addPlanReading,
  planReadings,
  dropPlanReadings,
  planCalibration,
  ecoCompare,
  dayDigest,
  status: () => status
}

parentPort!.on('message', (msg: { type: string; id?: number; op?: string; args?: unknown[] }) => {
  if (msg.type === 'run') {
    run().catch((err) => postStatus({ indexing: false, error: (err as Error).message }))
    return
  }
  if (msg.type === 'query' && msg.op) {
    try {
      const result = handlers[msg.op](...(msg.args ?? []))
      parentPort!.postMessage({ type: 'result', id: msg.id, result })
    } catch (err) {
      parentPort!.postMessage({ type: 'result', id: msg.id, error: (err as Error).message })
      if (isCorrupt(err) && !status.indexing) {
        resetDb()
        run().catch((e) => postStatus({ indexing: false, error: (e as Error).message }))
      }
    }
  }
})

postStatus(counts())
run().catch((err) => postStatus({ indexing: false, error: (err as Error).message }))
