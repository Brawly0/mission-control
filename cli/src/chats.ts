import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, isAbsolute } from 'node:path'

export interface ProjectChat { tool: 'claude' | 'codex'; id: string; title: string; updatedAt: number; file: string }
export interface ChatMessage { role: 'user' | 'assistant'; text: string; at?: number }

export function claudeProjectKey(path: string): string { return path.replace(/[^a-zA-Z0-9]/g, '-') }

async function chunk(file: string, tail: boolean): Promise<{ text: string; mtime: number }> {
  const handle = await open(file, 'r')
  try {
    const stat = await handle.stat()
    const size = Math.min(stat.size, (tail ? 256 : 64) * 1024)
    const start = tail ? stat.size - size : 0
    // Include the preceding byte so a record exactly on the boundary is retained.
    const offset = Math.max(0, start - 1)
    const length = size + (start > 0 ? 1 : 0)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    // Discard a potentially partial record, including when the window has no newline.
    if (start > 0) text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : ''
    return { text, mtime: stat.mtimeMs }
  } finally { await handle.close() }
}

function records(text: string): any[] {
  return text.split('\n').flatMap(line => { try { const v = JSON.parse(line); return v && typeof v === 'object' ? [v] : [] } catch { return [] } })
}

function message(e: any, tool: ProjectChat['tool']): ChatMessage | undefined {
  const m = tool === 'claude' ? e.message : e.type === 'response_item' && e.payload?.type === 'message' ? e.payload : undefined
  const role = tool === 'claude' ? e.type : m?.role
  if (!m || (role !== 'user' && role !== 'assistant') || e.isMeta) return undefined
  const content = m.content
  const raw = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(b => ['text', 'input_text', 'output_text'].includes(b?.type) && typeof b.text === 'string').map(b => b.text).join('\n') : ''
  const text = raw.replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi, '').trim()
  if (!text) return undefined
  const at = Date.parse(e.timestamp)
  return { role, text, ...(Number.isFinite(at) ? { at } : {}) }
}

function inside(root: string, cwd: unknown): boolean {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false
  let a = resolve(root), b = resolve(cwd)
  if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
  const rel = relative(a, b)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'))
}

async function entries(dir: string) {
  try { return await readdir(dir, { withFileTypes: true }) } catch { return [] }
}

async function inspect(file: string, tool: ProjectChat['tool'], root: string): Promise<ProjectChat | undefined> {
  try {
    const head = await chunk(file, false), rows = records(head.text)
    const meta = tool === 'codex' ? rows.find(e => e.type === 'session_meta')?.payload : rows.find(e => typeof e.cwd === 'string')
    if (!inside(root, meta?.cwd)) return undefined
    const title = rows.find(e => e.type === 'summary' && typeof e.summary === 'string')?.summary
      || rows.map(e => message(e, tool)).find(m => m?.role === 'user')?.text || 'Untitled chat'
    return { tool, id: meta?.id || meta?.sessionId || basename(file, '.jsonl'), title: title.replace(/\s+/g, ' ').slice(0, 160), updatedAt: head.mtime, file }
  } catch { return undefined }
}

export async function listProjectChats(root: string, limit = 20): Promise<ProjectChat[]> {
  if (limit <= 0) return []
  const chats: ProjectChat[] = []
  const claude = join(process.env.MC_CLAUDE_HOME ?? join(homedir(), '.claude'), 'projects')
  // Only this project's folder and its subfolders' (their keys start with the project key): opening every session of
  // every project on each plan would be slow. The cwd check in inspect() still rejects look-alike neighbours.
  const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s)
  const key = fold(claudeProjectKey(resolve(root)))
  const dirs = (await entries(claude)).filter(e => e.isDirectory() && (fold(e.name) === key || fold(e.name).startsWith(key + '-')))
  for (const dir of dirs) {
    for (const file of await entries(join(claude, dir.name))) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
      const chat = await inspect(join(claude, dir.name, file.name), 'claude', root)
      if (chat) chats.push(chat)
    }
  }
  const codex = join(process.env.MC_CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  let scanned = 0, matched = 0
  async function walk(dir: string, depth: number): Promise<void> {
    const files = (await entries(dir)).sort((a, b) => b.name.localeCompare(a.name))
    for (const entry of files) {
      if (scanned >= 400 || matched >= limit) return
      const file = join(dir, entry.name)
      if (entry.isDirectory() && depth < 3) await walk(file, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        scanned++
        const chat = await inspect(file, 'codex', root)
        if (chat) { chats.push(chat); matched++ }
      }
    }
  }
  await walk(codex, 0)
  return chats.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

export async function readChatTail(chat: ProjectChat, maxMessages = 12): Promise<ChatMessage[]> {
  if (maxMessages <= 0) return []
  try { return records((await chunk(chat.file, true)).text).flatMap(e => { const m = message(e, chat.tool); return m ? [m] : [] }).slice(-maxMessages) } catch { return [] }
}

export async function chatDigest(root: string, opts: { chats?: number; perChat?: number; maxChars?: number } = {}): Promise<string> {
  const parts: string[] = []
  for (const chat of await listProjectChats(root, opts.chats ?? 3)) {
    const messages = await readChatTail(chat, opts.perChat ?? 6)
    parts.push(`[${chat.tool === 'claude' ? 'Claude' : 'Codex'}] ${chat.title} (${new Date(chat.updatedAt).toISOString().slice(0, 10)})\n` + messages.map(m => `  ${m.role}: ${m.text.replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n'))
  }
  return parts.join('\n\n').slice(0, Math.max(0, opts.maxChars ?? 6000))
}
