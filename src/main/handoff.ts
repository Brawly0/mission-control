import { existsSync, mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentTool, Handoff, SessionSummary } from '../shared/types'
import { AGENTS_POINTER, handoffMarkdown, handoffPrompt } from '../shared/handoff'
import { briefingFileName, worktreeParent } from '../shared/projectLook'
import { folderFor, latestBriefing } from './briefings'
import { getSession, listProjects, listSessions, normalizePath } from './claudeData'
import { codexFileFor, getCodexSession } from './codexData'
import { handoffGitState } from './git'
import { invalidateKnowledge } from './hub'
import { sessionRecap } from './recap'
import { findSessionFile } from './spend'

/**
 * Hands a project from one agent to the other (ADR 0020): Mission Control writes what the last chat
 * did (prompts, files, commits, the latest messages) plus git's state and the rules files into
 * docs/briefings/, and the other agent starts by reading it. No model call; it costs nothing.
 */

const RECENT_MESSAGES = 6

function rulesIn(path: string): string[] {
  return ['CLAUDE.md', 'AGENTS.md'].filter((f) => existsSync(join(path, f)))
}

export async function writeHandoff(projectPath: string, from: AgentTool, to: AgentTool, sessionId?: string): Promise<Handoff> {
  const project = (await listProjects()).find((p) => normalizePath(p.path) === normalizePath(projectPath))
  const sessions = await listSessions(project?.keys ?? [], projectPath)
  const isFrom = (s: SessionSummary) => (s.tool ?? 'claude') === from
  const chat = sessionId ? sessions.find((s) => s.id === sessionId) : sessions.find((s) => isFrom(s) && s.firstPrompt)
  if (!chat) throw new Error(`There's no ${from === 'codex' ? 'Codex' : 'Claude'} chat in this project to hand off yet.`)

  const cwd = chat.cwd && existsSync(chat.cwd) ? chat.cwd : projectPath
  const recap = await sessionRecap(chat.id)
  const [detail, git, briefing, transcript] = await Promise.all([
    chat.tool === 'codex' ? getCodexSession(chat.id) : getSession(chat.projectKey, chat.id),
    // Commits since the chat began.
    handoffGitState(cwd, recap.startedAt),
    latestBriefing(projectPath).catch(() => null),
    chat.tool === 'codex' ? codexFileFor(chat.id) : findSessionFile(chat.id)
  ])
  const at = Date.now()
  const markdown = handoffMarkdown({
    from,
    to,
    projectName: project?.name ?? projectPath,
    cwd,
    title: chat.title,
    sessionId: chat.id,
    recap,
    recent: detail.messages.slice(-RECENT_MESSAGES),
    git,
    rules: rulesIn(worktreeParent(cwd) ? cwd : projectPath),
    transcript: transcript ?? undefined,
    briefing: briefing ?? undefined,
    at
  })
  const dir = folderFor(projectPath)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, briefingFileName(at, `handoff ${from} to ${to}`))
  writeFileSync(file, markdown, 'utf8')
  invalidateKnowledge()
  return { file, prompt: handoffPrompt(file, from), sessionId: chat.id, title: chat.title, cwd }
}

export function rulesFiles(projectPath: string): { claude: boolean; agents: boolean } {
  return { claude: existsSync(join(projectPath, 'CLAUDE.md')), agents: existsSync(join(projectPath, 'AGENTS.md')) }
}

/** Adds AGENTS.md that points Codex at CLAUDE.md; never overwrites an AGENTS.md that exists. */
export async function linkRules(projectPath: string): Promise<void> {
  const file = join(projectPath, 'AGENTS.md')
  if (existsSync(file)) return
  await fs.writeFile(file, AGENTS_POINTER, { encoding: 'utf8', flag: 'wx' })
  invalidateKnowledge()
}
