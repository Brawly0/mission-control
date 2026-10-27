import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { listProjects, listSessions, normalizePath } from './claudeData'
import { sessionRecap } from './recap'
import { handoffGitState } from './git'
import { loadStore } from './store'
import { projectRuns } from './projectCommands'
import { worktreeParent } from '../shared/projectLook'

const MARKER = '<!-- mission-control-recent -->'
export function projectBriefing(path: string) {
  const file = join(path, 'docs', 'BRIEFING.md')
  return { file, markdown: existsSync(file) ? readFileSync(file, 'utf8').slice(0, 100_000) : '' }
}
export function saveProjectBriefing(path: string, markdown: string) {
  if (markdown.length > 100_000) throw new Error('Keep the project briefing under 100,000 characters.')
  const { file } = projectBriefing(path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, markdown, 'utf8')
}
export function briefingContext(path: string, prompt: string): string {
  const root = worktreeParent(path)?.parent ?? path
  const file = join(root, 'docs', 'BRIEFING.md')
  return existsSync(file) ? `First read the shared project briefing at ${JSON.stringify(file)}. Check its date and verify anything that may have changed.\n\n${prompt}` : prompt
}
export async function draftProjectBriefing(path: string) {
  const saved = projectBriefing(path)
  const project = (await listProjects()).find(p => normalizePath(p.path) === normalizePath(path))
  const sessions = (await listSessions(project?.keys ?? [], path)).slice(0, 3)
  const git = await handoffGitState(path, Date.now() - 7 * 86400_000)
  const recaps = await Promise.all(sessions.map(s => sessionRecap(s.id)))
  const tasks = loadStore().tasks.filter(t => normalizePath(t.projectPath) === normalizePath(path) && t.column !== 'done')
  const manual = saved.markdown.split(MARKER)[0].trim() || `# ${project?.name ?? 'Project'} briefing\n\n## Current goal\n\n${project?.meta.notes || 'Describe the outcome you want next.'}\n\n## Decisions and constraints\n\nRecord the decisions both agents should follow.\n\n## Next steps\n\nWrite the unfinished work here.`
  const recent = sessions.map((s, i) => `### ${s.tool === 'codex' ? 'Codex' : 'Claude'}: ${s.title}\n\nUpdated: ${new Date(s.updatedAt).toISOString()}\nLatest ask: ${s.lastPrompt || s.firstPrompt}\nFiles: ${recaps[i].files.slice(0, 12).map(f => f.path).join(', ') || 'None recorded'}\nLatest reply:\n${recaps[i].lastReply.slice(0, 2500)}`).join('\n\n')
  const checks = projectRuns(path).map(r => `- ${r.name}: ${r.state}${r.exitCode === undefined ? '' : ` (exit ${r.exitCode})`} · ${new Date(r.finishedAt ?? r.startedAt).toISOString()}`)
  return { file: saved.file, markdown: `${manual}\n\n${MARKER}\n## Recent work (generated)\n\nRefreshed: ${new Date().toISOString()}\n\n${recent || 'No chats recorded yet.'}\n\n## Unfinished tasks\n\n${tasks.map(t => `- [${t.column}] ${t.title}${t.run?.error ? ` — ${t.run.error}` : ''}`).join('\n') || 'No open task cards.'}\n\n## Verification\n\n${checks.join('\n') || 'No project command results recorded in this app session.'}\n\n## Git\n\n${git ? ['Branch: ' + git.branch, ...git.status, ...git.commits].join('\n') : 'Not a git repository.'}\n\n## Shared rules\n\nRead CLAUDE.md and AGENTS.md if present. This briefing summarizes context; the project rules remain authoritative.\n` }
}
