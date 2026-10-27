import type { RateLimitInfo, SessionRecap } from './types'
import { commitMessage } from './recap'

/**
 * Codex CLI session files ("rollouts", ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl), read the
 * same way as Claude's transcripts: one JSON entry per line, only read, never written (ADR 0020).
 * Lines look like {timestamp, type, payload}; the format is undocumented, so unknown lines are skipped.
 */

/** The session id at the end of a rollout file name. */
export function codexIdFromFile(name: string): string | null {
  const m = /rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(name)
  return m ? m[1].toLowerCase() : null
}

function textParts(payload: any, kind: 'input_text' | 'output_text'): string {
  if (!Array.isArray(payload?.content)) return ''
  return payload.content
    .filter((c: any) => c?.type === kind && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('\n')
    .trim()
}

/** Something you typed: a user message that isn't context Codex adds itself (<environment_context>, AGENTS.md…). */
export function codexPrompt(entry: any): string {
  const p = entry?.payload
  if (entry?.type !== 'response_item' || p?.type !== 'message' || p.role !== 'user') return ''
  const text = textParts(p, 'input_text')
  if (!text || text.startsWith('<') || text.startsWith('# AGENTS.md')) return ''
  return text
}

/** Text Codex wrote back. */
export function codexReply(entry: any): string {
  const p = entry?.payload
  if (entry?.type !== 'response_item' || p?.type !== 'message' || p.role !== 'assistant') return ''
  return textParts(p, 'output_text')
}

/** The command line of a finished shell command, from its item_completed event. */
export function codexCommand(entry: any): string {
  const item = entry?.type === 'event_msg' && entry.payload?.type === 'item_completed' ? entry.payload.item : null
  if (item?.type !== 'CommandExecution') return ''
  const parsed = Array.isArray(item.parsed_cmd) ? item.parsed_cmd.map((c: any) => c?.cmd).filter((c: any) => typeof c === 'string') : []
  if (parsed.length) return parsed.join('; ')
  const cmd = Array.isArray(item.command) ? item.command[item.command.length - 1] : item.command
  return typeof cmd === 'string' ? cmd : ''
}

const PATCH_FILE = /\*\*\* (Add|Update|Delete) File: ([^\r\n"]+)/g

/** Tool input is often a patch inside a JS or JSON string literal, with \n and \\ escaped; undo that once. */
function unescaped(text: string): string {
  if (/[\r\n]/.test(text) || !/\\n/.test(text)) return text
  return text.replace(/\\(["\\nrt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c))
}

/** Files a tool call changed: apply_patch headers in the call, or a FileChange item's paths. */
export function codexFileChanges(entry: any): { path: string; created: boolean }[] {
  const p = entry?.payload
  const out: { path: string; created: boolean }[] = []
  if (entry?.type === 'response_item' && (p?.type === 'custom_tool_call' || p?.type === 'function_call')) {
    const text = unescaped(String(p.input ?? p.arguments ?? ''))
    for (const m of text.matchAll(PATCH_FILE)) out.push({ path: m[2].trim(), created: m[1] === 'Add' })
  } else if (entry?.type === 'event_msg' && p?.type === 'item_completed' && p.item?.type === 'FileChange') {
    const changes = p.item.changes
    const list = Array.isArray(changes) ? changes : changes && typeof changes === 'object' ? Object.entries(changes).map(([path, c]) => ({ path, ...(c as object) })) : []
    for (const c of list as any[]) if (typeof c?.path === 'string') out.push({ path: c.path, created: c.kind === 'add' || c.type === 'add' || c.kind?.type === 'add' })
  }
  return out
}

function shortPath(path: string, cwd: string): string {
  const p = path.replace(/\//g, '\\')
  const base = cwd.replace(/\//g, '\\').replace(/\\+$/, '')
  return base && p.toLowerCase().startsWith(base.toLowerCase() + '\\') ? p.slice(base.length + 1) : p
}

const BREAK_MS = 15 * 60_000
const KEEP = 3

/** The same "what we worked on" recap as Claude chats get (shared/recap.ts), built from a rollout. */
export function codexRecapBuilder(sessionId: string) {
  let cwd = ''
  let first = 0
  let last = 0
  let active = 0
  let prompts = 0
  const firstPrompts: { text: string; at: number }[] = []
  let recent: { text: string; at: number }[] = []
  const files = new Map<string, { path: string; edits: number; created: boolean }>()
  let commands = 0
  const commits: string[] = []
  let lastReply = ''
  let turnReply: string[] = []
  let compactions = 0

  return {
    add(e: any): void {
      if (e?.type === 'session_meta' && typeof e.payload?.cwd === 'string') cwd = e.payload.cwd
      if (e?.type === 'turn_context' && typeof e.payload?.cwd === 'string' && !cwd) cwd = e.payload.cwd
      const at = typeof e?.timestamp === 'string' ? Date.parse(e.timestamp) || 0 : 0
      if (at) {
        if (!first) first = at
        if (last && at > last && at - last < BREAK_MS) active += at - last
        if (at > last) last = at
      }
      if (e?.type === 'compacted') compactions++
      if (e?.type === 'event_msg' && e.payload?.type === 'task_started') turnReply = []
      const prompt = codexPrompt(e)
      if (prompt) {
        prompts++
        turnReply = []
        const item = { text: prompt.slice(0, 400), at }
        if (firstPrompts.length < KEEP) firstPrompts.push(item)
        else recent = [...recent, item].slice(-KEEP)
        return
      }
      const reply = codexReply(e)
      if (reply) {
        turnReply.push(reply)
        lastReply = turnReply.join('\n\n')
        return
      }
      const command = codexCommand(e)
      if (command) {
        commands++
        const msg = commitMessage(command)
        if (msg && !commits.includes(msg)) commits.push(msg)
        return
      }
      for (const f of codexFileChanges(e)) {
        const key = f.path.toLowerCase().replace(/\//g, '\\')
        const cur = files.get(key) ?? { path: f.path, edits: 0, created: false }
        cur.edits++
        if (f.created && cur.edits === 1) cur.created = true
        files.set(key, cur)
      }
    },
    done(): SessionRecap {
      const list = [...files.values()].sort((a, b) => b.edits - a.edits)
      return {
        sessionId,
        startedAt: first,
        endedAt: last,
        activeMinutes: Math.round(active / 60_000),
        prompts,
        firstPrompts,
        lastPrompts: recent,
        files: list.slice(0, 12).map((f) => ({ ...f, path: shortPath(f.path, cwd) })),
        filesTotal: list.length,
        commands,
        commits: commits.slice(-8),
        lastReply: lastReply.slice(0, 1500),
        compactions
      }
    }
  }
}

export interface CodexTokens {
  input: number
  cachedInput: number
  output: number
  reasoning: number
}

/** A token_count event's running total for the whole chat, or null for other lines. */
export function codexTotals(entry: any): CodexTokens | null {
  if (entry?.type !== 'event_msg' || entry.payload?.type !== 'token_count') return null
  const t = entry.payload.info?.total_token_usage
  if (!t) return null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { input: n(t.input_tokens), cachedInput: n(t.cached_input_tokens), output: n(t.output_tokens), reasoning: n(t.reasoning_output_tokens) }
}

/** Codex window lengths in minutes, mapped to the names Claude's plan windows use. */
const WINDOW_NAMES: Record<number, string> = { 300: 'five_hour', 10080: 'seven_day' }

/** The plan limits in a token_count event, as RateLimitInfo (utilization 0–1, resets in ms). */
export function codexLimits(entry: any): RateLimitInfo | null {
  const r = entry?.type === 'event_msg' && entry.payload?.type === 'token_count' ? entry.payload.rate_limits : null
  if (!r) return null
  const windows: RateLimitInfo['windows'] = []
  for (const w of [r.primary, r.secondary]) {
    if (!w || typeof w.used_percent !== 'number') continue
    const name = WINDOW_NAMES[w.window_minutes] ?? `${w.window_minutes}m`
    windows.push({ name, utilization: w.used_percent / 100, resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : 0 })
  }
  if (!windows.length) return null
  const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) || 0 : 0
  return { at, status: r.rate_limit_reached_type ? 'rejected' : 'allowed', windows, source: 'plan', plan: typeof r.plan_type === 'string' ? r.plan_type : undefined }
}

/**
 * Codex reports its state to the terminal with OSC 7501 ("state=working:app=codex"); Mission Control
 * turns those into status lights the way Claude's hooks do. Returns each state found in a chunk.
 */
export function codexStates(chunk: string): { state: string; kind?: string }[] {
  const out: { state: string; kind?: string }[] = []
  for (const m of chunk.matchAll(/\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
    const fields = Object.fromEntries(m[1].split(':').map((f) => f.split('=') as [string, string]))
    if (fields.app && fields.app !== 'codex') continue
    if (fields.state) out.push({ state: fields.state, kind: fields.kind })
  }
  return out
}
