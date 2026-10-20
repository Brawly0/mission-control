/**
 * Background indexer (worker thread). Reads Claude Code's session files and keeps a SQLite database
 * in the app's data folder with:
 *   - fts:      full-text index of human prompts and Claude's text replies
 *   - msgs:     one row per assistant API message with its token usage and estimated cost
 *   - sessions: title, project and dates per session
 *   - files:    how far each .jsonl has been read, so appended lines are indexed incrementally
 * Claude Code's files are only read, never written.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { costOf } from './pricing'
import { titleFromPrompt } from '../shared/projectLook'
import type { IndexStatus, SearchHit, UsageReport, UsageTotals } from '../shared/types'

const { dbPath, projectsDir } = workerData as { dbPath: string; projectsDir: string }
const SCHEMA_VERSION = 4
const MAX_BODY = 20_000

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)')
const version = (db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined)?.value
if (Number(version) !== SCHEMA_VERSION) {
  db.exec('DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS msgs; DROP TABLE IF EXISTS fts;')
}
db.exec(`
  CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, session_id TEXT, size INTEGER, mtime REAL, offset INTEGER);
  CREATE TABLE IF NOT EXISTS sessions(
    session_id TEXT PRIMARY KEY, project_key TEXT, project_path TEXT, title TEXT, custom_title TEXT,
    first_prompt TEXT, started INTEGER, updated INTEGER);
  CREATE TABLE IF NOT EXISTS msgs(
    session_id TEXT, msg_id TEXT, model TEXT, day TEXT, ts INTEGER,
    input INTEGER, output INTEGER, cw5 INTEGER, cw1h INTEGER, cread INTEGER, cost REAL,
    PRIMARY KEY(session_id, msg_id));
  CREATE INDEX IF NOT EXISTS msgs_ts ON msgs(ts);
  CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
    body, session_id UNINDEXED, role UNINDEXED, ts UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
`)
db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION))

const q = {
  getFile: db.prepare('SELECT size, mtime, offset FROM files WHERE path = ?'),
  putFile: db.prepare('INSERT OR REPLACE INTO files(path, session_id, size, mtime, offset) VALUES (?, ?, ?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE session_id = ?'),
  putSession: db.prepare(
    `INSERT OR REPLACE INTO sessions(session_id, project_key, project_path, title, custom_title, first_prompt, started, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getMsg: db.prepare('SELECT input, output, cw5, cw1h, cread FROM msgs WHERE session_id = ? AND msg_id = ?'),
  putMsg: db.prepare(
    `INSERT OR REPLACE INTO msgs(session_id, msg_id, model, day, ts, input, output, cw5, cw1h, cread, cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  addFts: db.prepare('INSERT INTO fts(body, session_id, role, ts) VALUES (?, ?, ?, ?)'),
  dropFts: db.prepare('DELETE FROM fts WHERE session_id = ?'),
  dropMsgs: db.prepare('DELETE FROM msgs WHERE session_id = ?'),
  dropFiles: db.prepare('DELETE FROM files WHERE session_id = ?')
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
        if (ts && (!row.started || ts < row.started)) row.started = ts
        if (e.type === 'custom-title' && typeof e.customTitle === 'string') row.custom_title = e.customTitle
        // Claude Code's automatic chat name; a title set with /rename replaces it.
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

// ---------------------------------------------------------------- messages

const handlers: Record<string, (...args: any[]) => unknown> = {
  search,
  usageReport,
  sessionUsage,
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
    }
  }
})

postStatus(counts())
run().catch((err) => postStatus({ indexing: false, error: (err as Error).message }))
