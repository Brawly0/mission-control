import type { AgentTool, ChatMessage, SessionRecap } from './types'
import { activeTime } from './recap'

/**
 * Handoffs between Claude and Codex (ADR 0020): one Markdown file, written from the finished chat's
 * transcript and the project's git state for free, that the other agent reads first. Pure, unit-tested.
 */

export const TOOL_NAME: Record<AgentTool, string> = { claude: 'Claude', codex: 'Codex' }

export function otherTool(tool: AgentTool): AgentTool {
  return tool === 'claude' ? 'codex' : 'claude'
}

export interface HandoffInput {
  from: AgentTool
  to: AgentTool
  projectName: string
  /** The folder the chat ran in (a worktree's own folder for worktree chats). */
  cwd: string
  title: string
  sessionId: string
  recap: SessionRecap
  /** The chat's latest messages, oldest first. */
  recent: ChatMessage[]
  git: { branch: string; status: string[]; commits: string[] } | null
  /** Rules files that exist in the project, e.g. ['CLAUDE.md', 'AGENTS.md']. */
  rules: string[]
  transcript?: string
  briefing?: string
  at: number
}

const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n).trimEnd() + ' …' : text)
const quote = (text: string) => text.split('\n').map((l) => `> ${l}`).join('\n')
const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

export function handoffMarkdown(h: HandoffInput): string {
  const from = TOOL_NAME[h.from]
  const to = TOOL_NAME[h.to]
  const r = h.recap
  const span = r.startedAt ? `${when(r.startedAt)} to ${when(r.endedAt || r.startedAt)}, ${activeTime(r.activeMinutes)} active` : 'no timestamps'
  const out: string[] = [
    `# Handoff: ${from} to ${to}`,
    '',
    `${when(h.at)} · ${h.projectName} · written by Mission Control from ${from}'s chat "${h.title}" (${span}, ${r.prompts} prompt${r.prompts === 1 ? '' : 's'}).`,
    '',
    `You're ${to}, taking over this project from ${from}. Read this, then check the files it names before changing anything. Folder: \`${h.cwd}\``,
    '',
    '## Project rules',
    ''
  ]
  if (h.rules.length) out.push(`Read ${h.rules.map((f) => `\`${f}\``).join(' and ')} first. The same rules apply to both agents.`)
  else out.push('This project has no CLAUDE.md or AGENTS.md. Follow the style of the code around what you change.')

  const prompts = [...r.firstPrompts, ...r.lastPrompts]
  if (prompts.length) {
    out.push('', '## What the user asked', '')
    if (r.firstPrompts.length) out.push('First:', ...r.firstPrompts.map((p) => `- ${clip(p.text.replace(/\s+/g, ' '), 300)}`))
    if (r.lastPrompts.length) out.push('', 'Latest:', ...r.lastPrompts.map((p) => `- ${clip(p.text.replace(/\s+/g, ' '), 300)}`))
  }

  out.push('', `## What ${from} changed`, '')
  if (r.files.length) {
    out.push(`Files (${r.filesTotal}${r.filesTotal > r.files.length ? `, the ${r.files.length} edited most` : ''}):`)
    out.push(...r.files.map((f) => `- \`${f.path}\`${f.created ? ' (new)' : ''}${f.edits > 1 ? ` · ${f.edits} edits` : ''}`))
  } else out.push(`No file edits were found in the transcript${h.from === 'codex' ? ' (Codex can also change files through shell commands; check git below)' : ''}.`)
  if (r.commits.length) out.push('', 'Commits:', ...r.commits.map((c) => `- ${c}`))
  out.push('', `Shell commands run: ${r.commands}.${r.compactions ? ` The chat was compacted ${r.compactions} time${r.compactions > 1 ? 's' : ''}.` : ''}`)

  if (h.git) {
    out.push('', '## Where git stands now', '', `Branch: \`${h.git.branch || 'unknown'}\``)
    if (h.git.status.length) out.push('', `Uncommitted changes (${h.git.status.length}):`, '```', ...h.git.status.slice(0, 40), ...(h.git.status.length > 40 ? ['…'] : []), '```')
    else out.push('', 'No uncommitted changes.')
    if (h.git.commits.length) out.push('', 'Commits since the chat started:', '```', ...h.git.commits, '```')
  }

  if (r.lastReply) out.push('', `## ${from}'s last reply`, '', quote(clip(r.lastReply, 1500)))

  if (h.recent.length) {
    out.push('', '## The latest exchange', '')
    for (const m of h.recent) out.push(`**${m.role === 'user' ? 'User' : from}:**`, '', clip(m.text.trim(), 1500), '')
  }

  out.push('', '## More detail', '')
  if (h.briefing) out.push(`- Latest session briefing: \`${h.briefing}\``)
  if (h.transcript) out.push(`- Full transcript (JSONL, can be large; read the end): \`${h.transcript}\``)
  out.push(`- ${from}'s chat id: \`${h.sessionId}\``, '')
  return out.join('\n')
}

/** What the new agent is told: the same shape as starting from a briefing. */
export function handoffPrompt(file: string, from: AgentTool): string {
  return `Read the handoff at "${file}". ${TOOL_NAME[from]} worked on this project before you, and the file lists what was asked, what changed, where git stands and the project's rules. Then tell me in a few lines where things stand and what you'd do next, and wait for my go-ahead.`
}

/** AGENTS.md for a project that only has CLAUDE.md, so Codex follows the same rules without a second copy. */
export const AGENTS_POINTER = `# Agent instructions

This project's rules live in [CLAUDE.md](CLAUDE.md). Read it first and follow it: the same rules apply to every coding agent here (Claude Code and Codex).
`
