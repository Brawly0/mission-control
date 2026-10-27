import type { AgentTool, WorktreeInfo } from '@shared/types'

/** Status reported by Claude Code hooks (or Codex's own state signals); exact, unlike the output-timing guess. */
export type HookStatus = 'ready' | 'working' | 'needs-input' | 'done'

export interface Agent {
  /** PTY id from the main process; also the id hook events are tagged with. */
  id: string
  title: string
  cwd: string
  projectName: string
  /** The project this agent belongs to (its main folder, even when it runs in a worktree). */
  projectPath: string
  kind: AgentTool | 'shell'
  sessionId?: string
  /** Set when the agent runs in its own worktree + branch. */
  worktree?: WorktreeInfo
  exited: boolean
  exitCode?: number
  startedAt: number
  hookStatus?: HookStatus
  /** When hookStatus last changed. */
  statusAt?: number
  /** The chat this agent resumed, for the "last time" recap above its terminal. */
  resumedFrom?: string
  /** Last notification text from Claude, e.g. "Claude needs your permission to use Bash". */
  statusMessage?: string
}

export type AgentLayout = 'tabs' | 'grid'
export type View = 'home' | 'inbox' | 'project' | 'projects' | 'agents' | 'search' | 'usage' | 'tasks' | 'notebook' | 'knowledge' | 'skills'

export interface LaunchOptions {
  cwd: string
  projectName: string
  projectPath?: string
  title: string
  kind?: AgentTool | 'shell'
  args?: string[]
  worktree?: WorktreeInfo
}
