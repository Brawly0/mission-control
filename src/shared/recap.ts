import type { SessionRecap } from './types'

/**
 * "What we worked on": a recap of one chat built from its transcript, for free (ADR 0017).
 * Feed every transcript entry to `add`, then call `done`. Only what's needed is kept, so a
 * 30 MB chat costs one pass and a few kilobytes.
 */

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Gaps longer than this between entries count as a break, not work. */
const BREAK_MS = 15 * 60_000
const KEEP = 3

function textOf(entry: any): string {
  const content = entry?.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
}

/** A prompt you typed: not a tool result, command wrapper, compaction summary or interrupt notice. */
export function humanPrompt(entry: any): string {
  if (entry?.type !== 'user' || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return ''
  const text = textOf(entry).trim()
  if (!text || text.startsWith('<') || text.startsWith('[Request interrupted')) return ''
  return text
}

/** The first line of a `git commit -m "…"` (or -m '…') command, if it is one. */
export function commitMessage(command: string): string {
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(command)) return ''
  // Heredoc messages: the first non-empty line after the <<'EOF' marker.
  const heredoc = /<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1/.exec(command)
  if (heredoc) return heredoc[2].split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const m = /-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(command)
  return (m?.[1] ?? m?.[2] ?? '').split('\n')[0].trim()
}

function shortPath(path: string, cwd: string): string {
  const p = path.replace(/\//g, '\\')
  const base = cwd.replace(/\//g, '\\').replace(/\\+$/, '')
  return base && p.toLowerCase().startsWith(base.toLowerCase() + '\\') ? p.slice(base.length + 1) : p
}

export function recapBuilder(sessionId: string) {
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
  let compactions = 0
  let replyParts: string[] = []
  let replyId = ''

  return {
    add(e: any): void {
      if (!cwd && typeof e?.cwd === 'string') cwd = e.cwd
      const at = typeof e?.timestamp === 'string' ? Date.parse(e.timestamp) || 0 : 0
      if (at && !e.isSidechain) {
        if (!first) first = at
        if (last && at > last && at - last < BREAK_MS) active += at - last
        if (at > last) last = at
      }
      if (e?.isSidechain) return
      if (e?.type === 'system' && e.subtype === 'compact_boundary') compactions++
      const prompt = humanPrompt(e)
      if (prompt) {
        prompts++
        const item = { text: prompt.slice(0, 400), at }
        if (firstPrompts.length < KEEP) firstPrompts.push(item)
        else recent = [...recent, item].slice(-KEEP)
        return
      }
      if (e?.type !== 'assistant' || !Array.isArray(e.message?.content)) return
      // A reply arrives as several entries with the same message id; its text parts make the reply.
      const id = String(e.message.id ?? '')
      if (id !== replyId) {
        replyId = id
        replyParts = []
      }
      for (const b of e.message.content) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          replyParts.push(b.text.trim())
          lastReply = replyParts.join('\n\n')
        }
        if (b?.type !== 'tool_use' || !b.input) continue
        if (EDIT_TOOLS.has(b.name)) {
          const raw = b.input.file_path ?? b.input.notebook_path
          if (typeof raw !== 'string') continue
          const key = raw.toLowerCase().replace(/\//g, '\\')
          const f = files.get(key) ?? { path: raw, edits: 0, created: false }
          f.edits++
          if (b.name === 'Write' && f.edits === 1) f.created = true
          files.set(key, f)
        } else if (b.name === 'Bash' && typeof b.input.command === 'string') {
          commands++
          const msg = commitMessage(b.input.command)
          if (msg && !commits.includes(msg)) commits.push(msg)
        }
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

/** "2h 10m", "45m". */
export function activeTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** What a one-shot Claude call gets to summarize a chat: the recap, as compact text. */
export function recapMaterial(r: SessionRecap, title: string): string {
  const lines = [`Chat title so far: ${title}`, `Prompts: ${r.prompts}, active ${activeTime(r.activeMinutes)}, ${r.compactions} compactions.`]
  const prompts = [...r.firstPrompts, ...r.lastPrompts]
  if (prompts.length) lines.push('What the user asked (first and latest):', ...prompts.map((p) => `- ${p.text.replace(/\s+/g, ' ').slice(0, 300)}`))
  if (r.files.length) lines.push(`Files changed (${r.filesTotal}): ${r.files.map((f) => `${f.path}${f.created ? ' (new)' : ''}`).join(', ')}`)
  if (r.commits.length) lines.push('Commits:', ...r.commits.map((c) => `- ${c}`))
  if (r.lastReply) lines.push("Claude's last reply:", r.lastReply.slice(0, 1200))
  return lines.join('\n')
}

/** Reads the {title, bullets, next} JSON a summarize call returns, tolerating code fences and stray text. */
export function parseAiRecap(text: string): { title: string; bullets: string[]; next?: string } | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const title = typeof j.title === 'string' ? j.title.trim().slice(0, 80) : ''
    const bullets = Array.isArray(j.bullets) ? j.bullets.filter((b: unknown) => typeof b === 'string' && b.trim()).map((b: string) => b.trim().slice(0, 240)).slice(0, 6) : []
    if (!title || !bullets.length) return null
    return { title, bullets, next: typeof j.next === 'string' && j.next.trim() ? j.next.trim().slice(0, 240) : undefined }
  } catch {
    return null
  }
}

/** Reads the {"1": "title", …} JSON a naming call returns. */
export function parseNames(text: string): Record<string, string> {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return {}
  try {
    const j = JSON.parse(m[0])
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && v.trim()) out[k] = v.trim().replace(/^["']|["']$/g, '').slice(0, 80)
    return out
  } catch {
    return {}
  }
}
