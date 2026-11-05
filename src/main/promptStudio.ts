import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import { dialog } from 'electron'
import {
  MAX_RESOURCE_CHARS,
  PROMPT_STUDIO_SYSTEM,
  buildStudioInput,
  htmlToText,
  parseStudioReply,
  pickResources,
  timedTextToText,
  youtubeVideoId,
  type PromptChatReply,
  type PromptChatRequest,
  type PromptResource,
  type PromptSnippet
} from '../shared/promptStudio'
import { askClaude } from './recap'
import { loadStore, updateStore } from './store'
import { getMainWindow } from './window'

/** Prompt Studio (ADR 0035). Resources and saved prompts are Mission Control's own data in store.json. */

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.yml', '.yaml', '.toml', '.csv', '.html', '.htm', '.ts', '.tsx', '.js', '.py'])
const clip = (s: string) => s.replace(/\r\n/g, '\n').slice(0, MAX_RESOURCE_CHARS)

export function listPromptResources(): PromptResource[] {
  return loadStore().promptResources
}

export function savePromptResource(input: Partial<PromptResource> & { title: string; content: string }): PromptResource {
  const title = input.title.trim().slice(0, 120) || 'Untitled'
  const content = clip(input.content)
  if (!content.trim()) throw new Error('Add some text for the generator to learn from.')
  let saved!: PromptResource
  updateStore((s) => {
    const existing = input.id ? s.promptResources.find((r) => r.id === input.id) : undefined
    if (existing) {
      Object.assign(existing, { title, content, source: input.source ?? existing.source, target: input.target, enabled: input.enabled ?? existing.enabled })
      saved = existing
    } else {
      saved = { id: randomUUID(), title, content, source: input.source, target: input.target, enabled: input.enabled ?? true, createdAt: Date.now() }
      s.promptResources.unshift(saved)
    }
  })
  return saved
}

export function deletePromptResource(id: string): void {
  updateStore((s) => {
    s.promptResources = s.promptResources.filter((r) => r.id !== id)
  })
}

/** Adds a web page as a resource: fetched once here, turned into plain text, capped. Nothing is sent anywhere else. */
export async function importResourceFromUrl(url: string): Promise<PromptResource> {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new Error('That is not a web address.')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https addresses work.')
  const video = youtubeVideoId(u.toString())
  if (video) return importYoutube(video)
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'MissionControl-PromptStudio' } })
  if (!res.ok) throw new Error(`The page answered ${res.status}.`)
  const type = res.headers.get('content-type') ?? ''
  const body = (await res.text()).slice(0, 2_000_000)
  const text = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(body) ? htmlToText(body) : body
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || u.hostname + u.pathname
  return savePromptResource({ title, content: text, source: u.toString() })
}

/** A YouTube video's captions as a resource (no API key: the same caption list the mobile player reads). */
async function importYoutube(id: string): Promise<PromptResource> {
  const source = `https://www.youtube.com/watch?v=${id}`
  const known = loadStore().promptResources.find((r) => r.source === source)
  if (known) return known
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)' },
    body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } }, videoId: id })
  })
  if (!res.ok) throw new Error(`YouTube answered ${res.status}.`)
  const info = (await res.json()) as {
    videoDetails?: { title?: string; author?: string }
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string }[] } }
  }
  const tracks = info.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  const track = tracks.find((t) => t.languageCode.startsWith('en') && t.kind !== 'asr') ?? tracks.find((t) => t.languageCode.startsWith('en')) ?? tracks[0]
  if (!track) throw new Error('That video has no captions to learn from.')
  const cap = await fetch(track.baseUrl, { signal: AbortSignal.timeout(20_000) })
  if (!cap.ok) throw new Error(`The captions answered ${cap.status}.`)
  const text = timedTextToText(await cap.text())
  if (!text) throw new Error('The captions were empty.')
  const by = info.videoDetails?.author ? ` (${info.videoDetails.author})` : ''
  return savePromptResource({ title: `${info.videoDetails?.title ?? 'YouTube video'}${by}`, content: text, source })
}

/** Adds text files picked in a native dialog. Returns what was added. */
export async function importResourceFiles(): Promise<PromptResource[]> {
  const win = getMainWindow()
  const opts = { title: 'Add resources', properties: ['openFile' as const, 'multiSelections' as const], filters: [{ name: 'Text and Markdown', extensions: [...TEXT_EXT].map((e) => e.slice(1)) }] }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled) return []
  const added: PromptResource[] = []
  for (const file of result.filePaths.slice(0, 20)) {
    if (!TEXT_EXT.has(extname(file).toLowerCase())) continue
    const stat = await fs.stat(file)
    if (stat.size > 2_000_000) continue
    const raw = await fs.readFile(file, 'utf8')
    const text = /\.html?$/i.test(file) ? htmlToText(raw) : raw
    if (text.trim()) added.push(savePromptResource({ title: basename(file), content: text, source: file }))
  }
  return added
}

export function listPromptSnippets(): PromptSnippet[] {
  return loadStore().promptSnippets
}

export function savePromptSnippet(input: { title: string; text: string; target: PromptSnippet['target'] }): PromptSnippet {
  if (!input.text.trim()) throw new Error('There is no prompt to save.')
  const snippet: PromptSnippet = { id: randomUUID(), title: input.title.trim().slice(0, 80) || 'Saved prompt', text: input.text, target: input.target, createdAt: Date.now() }
  updateStore((s) => {
    s.promptSnippets.unshift(snippet)
    s.promptSnippets = s.promptSnippets.slice(0, 200)
  })
  return snippet
}

export function deletePromptSnippet(id: string): void {
  updateStore((s) => {
    s.promptSnippets = s.promptSnippets.filter((p) => p.id !== id)
  })
}

/** One generator turn: picks the relevant resources, asks Claude (Sonnet, no tools), returns a question or the prompt. */
export async function promptStudioChat(req: PromptChatRequest): Promise<PromptChatReply> {
  if (!req.messages.length || req.messages[req.messages.length - 1].role !== 'user') throw new Error('Say what you want a prompt for first.')
  const query = req.messages.filter((m) => m.role === 'user').map((m) => m.text).join('\n')
  const picked = pickResources(loadStore().promptResources, query, req.target)
  const raw = await askClaude(buildStudioInput(req, picked), PROMPT_STUDIO_SYSTEM, 'sonnet')
  return parseStudioReply(raw, picked.map((r) => r.title))
}
