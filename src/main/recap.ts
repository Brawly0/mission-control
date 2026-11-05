import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createReadStream, promises as fs } from 'node:fs'
import { basename, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import type { AiRecap, SessionRecap } from '../shared/types'
import { parseAiRecap, parseNames, recapBuilder, recapMaterial } from '../shared/recap'
import { summarizeSession } from './claudeData'
import { codexRecap, codexSummary } from './codexData'
import { findSessionFile } from './spend'
import { claudeCommand } from './tasks'
import { agentEnv } from './pty'
import { loadStore, updateStore } from './store'

/**
 * "What we worked on" (ADR 0017): a free recap of a chat read from its transcript, and two
 * optional one-shot Haiku calls: a summary with a clear title for one chat, and names for many.
 * Transcripts are only read; what Claude writes is kept in Mission Control's store.
 */

const cache = new Map<string, { size: number; mtime: number; recap: SessionRecap }>()

async function fileFor(sessionId: string): Promise<string> {
  const file = await findSessionFile(sessionId)
  if (!file) throw new Error('This chat has no transcript (yet).')
  return file
}

/** Reads the whole transcript as a stream (it can be 30+ MB) and keeps only the recap; cached until the file changes. */
export async function sessionRecap(sessionId: string): Promise<SessionRecap> {
  if (!(await findSessionFile(sessionId))) {
    const codex = await codexRecap(sessionId)
    if (codex) {
      const ai = loadStore().chatRecaps[sessionId]
      return ai ? { ...codex, ai } : codex
    }
  }
  const file = await fileFor(sessionId)
  const st = await fs.stat(file)
  const hit = cache.get(sessionId)
  let recap = hit && hit.size === st.size && hit.mtime === st.mtimeMs ? hit.recap : null
  if (!recap) {
    const b = recapBuilder(sessionId)
    const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line) continue
      try {
        b.add(JSON.parse(line))
      } catch {
        /* partial line */
      }
    }
    recap = b.done()
    cache.set(sessionId, { size: st.size, mtime: st.mtimeMs, recap })
  }
  const ai = loadStore().chatRecaps[sessionId]
  return ai ? { ...recap, ai } : recap
}

/**
 * One Claude call with no tools, no MCP servers and nothing saved as a chat (so no stray project
 * appears), on Haiku with a short system prompt: about a thousand tokens, a fraction of a cent.
 */
export async function askClaude(prompt: string, system: string, model = 'haiku'): Promise<string> {
  const { file, prefix } = claudeCommand()
  const args = [...prefix, '-p', '--model', model, '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--output-format', 'json', '--system-prompt', system]
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: app.getPath('userData'), env: agentEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude took too long to answer.'))
    }, 120_000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out)
        if (j.is_error) return reject(new Error(String(j.result || 'Claude returned an error.')))
        resolve(String(j.result ?? ''))
      } catch {
        reject(new Error((err || out || `claude exited with code ${code}`).trim().slice(0, 300)))
      }
    })
    child.stdin.end(prompt)
  })
}

const SUMMARY_SYSTEM =
  'You summarize Claude Code chats for the person who had them, so they can pick up where they left off. ' +
  'Reply with JSON only: {"title": "a clear 3-7 word name saying what was worked on (no dates, no quotes)", ' +
  '"bullets": ["2-5 short past-tense points of what got done or decided, most important first"], ' +
  '"next": "what is still open, or an empty string"}. Plain words, no markdown.'

const NAMES_SYSTEM =
  'You name Claude Code chats. Each name is 3-7 words and says specifically what was worked on: the feature, bug, topic or decision. ' +
  'Avoid generic words like session, briefing, chat, help or question unless that is all there is. No dates, no quotes. ' +
  'Reply with JSON only: {"<number>": "name", ...}.'

/** Claude's summary and a clear title for one chat; kept, and the title used unless you named the chat yourself. */
export async function summarizeChat(sessionId: string): Promise<AiRecap> {
  const recap = await sessionRecap(sessionId)
  const file = await findSessionFile(sessionId)
  const summary = file ? await summarizeSession(basename(dirname(file)), file) : await codexSummary(sessionId)
  if (!summary) throw new Error('This chat has no transcript (yet).')
  const parsed = parseAiRecap(await askClaude(recapMaterial(recap, summary.title), SUMMARY_SYSTEM))
  if (!parsed) throw new Error("Claude's answer couldn't be read. Try again.")
  const ai: AiRecap = { ...parsed, at: Date.now() }
  updateStore((s) => {
    s.chatRecaps[sessionId] = ai
    s.chatAiNames[sessionId] = ai.title
  })
  return ai
}

/**
 * Names the given chats (the UI picks the unclear ones), up to 40 in one call, skipping chats you
 * named in Mission Control and chats Claude already named. Returns how many got a name.
 */
export async function nameChats(sessionIds: string[]): Promise<number> {
  const store = loadStore()
  const todo: { id: string; first: string; last: string; files: string; reply: string }[] = []
  for (const id of sessionIds) {
    if (todo.length >= 40) break
    if (store.chatTitles[id] || store.chatAiNames[id]) continue
    const file = await findSessionFile(id)
    if (!file) continue
    const s = await summarizeSession(basename(dirname(file)), file).catch(() => null)
    if (!s || !s.firstPrompt) continue
    const r = await sessionRecap(id).catch(() => null)
    todo.push({
      id,
      first: s.firstPrompt,
      last: s.lastPrompt ?? '',
      files: r?.files.slice(0, 5).map((f) => f.path.split(/[\\/]/).pop()).join(', ') ?? '',
      reply: r?.lastReply ?? ''
    })
  }
  if (!todo.length) return 0
  const clip = (t: string, n: number) => t.replace(/\s+/g, ' ').slice(0, n)
  const prompt = todo
    .map((c, i) =>
      [
        `${i + 1}. First prompt: ${clip(c.first, 300)}`,
        c.last && `   Latest prompt: ${clip(c.last, 200)}`,
        c.files && `   Files changed: ${c.files}`,
        c.reply && `   Claude's last reply begins: ${clip(c.reply, 240)}`
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n')
  const names = parseNames(await askClaude(prompt, NAMES_SYSTEM))
  let named = 0
  updateStore((s) => {
    todo.forEach((c, i) => {
      const n = names[String(i + 1)]
      if (n && !s.chatTitles[c.id]) {
        s.chatAiNames[c.id] = n
        named++
      }
    })
  })
  return named
}
