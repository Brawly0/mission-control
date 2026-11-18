import { app } from 'electron'
import { existsSync, mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Briefing } from '../shared/types'
import { COMPACT_INSTRUCTIONS, briefingFileName, briefingMarkdown, folderLabel, projectRootOf, worktreeParent } from '../shared/projectLook'
import { claudeProjectsDir, listProjects, movedChatList, normalizePath } from './claudeData'
import { invalidateKnowledge } from './hub'
import { queryIndex } from './indexer'
import { loadStore, updateStore } from './store'

/**
 * Session briefings: when a chat runs out of room, Claude Code writes a summary to carry on with.
 * Mission Control saves each one as a Markdown file in the project's docs/briefings/ folder, so the
 * next session can start from it. Chats without a real project folder (C:\, temp) save to the app's folder.
 */

interface Row {
  sessionId: string
  at: number
  trigger: string
  preTokens: number
  text: string
  title: string
  projectKey: string
  projectPath: string
}

const key = (r: { sessionId: string; at: number }) => `${r.sessionId}:${r.at}`

/** The project a chat belongs to: where Mission Control lists it (worktrees and chats started from C:\ included). */
function projectOf(r: Row): string {
  const moved = movedChatList().find((m) => m.id === r.sessionId)
  if (moved) return moved.path
  return worktreeParent(r.projectPath)?.parent ?? r.projectPath
}

/** docs/briefings/ in a real project folder, else Mission Control's own briefings folder. */
export function folderFor(projectPath: string): string {
  const root = projectPath ? projectRootOf(projectPath, homedir(), (dir) => existsSync(join(dir, '.git')) || existsSync(join(dir, 'CLAUDE.md'))) : null
  if (root && normalizePath(root) === normalizePath(projectPath) && existsSync(projectPath)) return join(projectPath, 'docs', 'briefings')
  return join(app.getPath('userData'), 'briefings')
}

/** Display names of your projects ("Mission Control", not "claude-hub"), by lower-cased path. */
async function projectNames(): Promise<Map<string, string>> {
  return new Map((await listProjects()).map((p) => [normalizePath(p.path), p.name]))
}

function toBriefing(r: Row, names?: Map<string, string>): Briefing {
  const projectPath = projectOf(r)
  return {
    sessionId: r.sessionId,
    at: r.at,
    trigger: r.trigger,
    preTokens: r.preTokens,
    title: r.title,
    projectPath,
    projectName: names?.get(normalizePath(projectPath)) ?? folderLabel(projectPath),
    text: r.text,
    transcript: r.projectKey ? join(claudeProjectsDir, r.projectKey, `${r.sessionId}.jsonl`) : undefined,
    savedPath: loadStore().briefingsSaved[key(r)]
  }
}

function write(b: Briefing): string {
  const dir = folderFor(b.projectPath)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, briefingFileName(b.at, b.title))
  writeFileSync(file, briefingMarkdown(b), 'utf8')
  updateStore((s) => {
    s.briefingsSaved[key(b)] = file
  })
  invalidateKnowledge()
  return file
}

/** Every briefing in your chats, newest first, with where it was saved (if it was). */
export async function listBriefings(): Promise<Briefing[]> {
  const rows = await queryIndex<Row[]>('briefings', 0, 300).catch(() => [] as Row[])
  const names = await projectNames()
  return rows.map((r) => toBriefing(r, names))
}

/** Saves one briefing (for older ones, saved by hand). Returns the file. */
export async function saveBriefing(sessionId: string, at: number): Promise<string> {
  const rows = await queryIndex<Row[]>('briefings', at, 300)
  const r = rows.find((x) => x.sessionId === sessionId && x.at === at)
  if (!r) throw new Error('That briefing is no longer in the chat index.')
  return write(toBriefing(r, await projectNames()))
}

/**
 * Saves briefings from compactions since the feature was first turned on (older ones stay in the list
 * to save by hand). Called after each index run; \`notify\` shows a Windows notification.
 */
export async function saveNewBriefings(notify: (b: Briefing, file: string) => void): Promise<void> {
  const store = loadStore()
  if (!store.settings.autoBriefings) return
  if (!store.briefingsFrom) {
    // First run: start from now, so the app doesn't drop old briefings into your projects unasked.
    updateStore((s) => {
      s.briefingsFrom = Date.now()
    })
    return
  }
  const rows = (await queryIndex<Row[]>('briefings', store.briefingsFrom, 100).catch(() => [] as Row[])).filter((r) => !store.briefingsSaved[key(r)])
  if (!rows.length) return
  const names = await projectNames()
  for (const r of rows.reverse()) {
    try {
      const b = toBriefing(r, names)
      notify(b, write(b))
    } catch {
      /* folder not writable: it stays in the list to save by hand */
    }
  }
}

/** The newest saved briefing for a project, for "New session from latest briefing". */
export async function latestBriefing(projectPath: string): Promise<string | null> {
  const want = normalizePath(projectPath)
  // Both sources count: briefings auto-saved from compactions, and ones written by hand,
  // "Write briefing" or a handoff in docs/briefings/. The newest of either wins.
  const candidates = new Set(
    (await listBriefings()).filter((b) => b.savedPath && normalizePath(b.projectPath) === want && existsSync(b.savedPath)).map((b) => b.savedPath as string)
  )
  try {
    const dir = join(projectPath, 'docs', 'briefings')
    for (const f of await fs.readdir(dir)) if (f.toLowerCase().endsWith('.md')) candidates.add(join(dir, f))
  } catch {
    /* no docs/briefings/ folder */
  }
  const ranked = await Promise.all([...candidates].map(async (file) => ({ file, t: await briefingTime(file) })))
  ranked.sort((a, b) => b.t - a.t)
  return ranked[0]?.file ?? null
}

/** When a briefing was written: the "YYYY-MM-DD-HHMM" its file name starts with, else the file's modified time. */
async function briefingTime(file: string): Promise<number> {
  const m = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})[^\\/]*$/.exec(file)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime()
  try {
    return (await fs.stat(file)).mtimeMs
  } catch {
    return 0
  }
}

/** Whether a project's CLAUDE.md already asks for briefing-style summaries. */
export async function hasSummaryInstructions(projectPath: string): Promise<boolean> {
  try {
    return /^#+\s*Summary instructions/im.test(await fs.readFile(join(projectPath, 'CLAUDE.md'), 'utf8'))
  } catch {
    return false
  }
}

/** Appends the summary instructions to the project's CLAUDE.md (creating it if needed). */
export async function addSummaryInstructions(projectPath: string): Promise<void> {
  if (await hasSummaryInstructions(projectPath)) return
  const file = join(projectPath, 'CLAUDE.md')
  let current = ''
  try {
    current = await fs.readFile(file, 'utf8')
  } catch {
    /* new file */
  }
  await fs.writeFile(file, `${current.replace(/\s*$/, '')}${current ? '\n\n' : ''}${COMPACT_INSTRUCTIONS}`, 'utf8')
  invalidateKnowledge()
}
