import type { WorktreeInfo } from '@shared/types'

/** Status reported by Claude Code hooks; exact, unlike the output-timing guess. */
export type HookStatus = 'ready' | 'working' | 'needs-input' | 'done'

export interface Agent {
  /** PTY id from the main process; also the id hook events are tagged with. */
  id: string
  title: string
  cwd: string
  projectName: string
  /** The project this agent belongs to (its main folder, even when it runs in a worktree). */
  projectPath: string
  kind: 'claude' | 'shell'
  sessionId?: string
  /** Set when the agent runs in its own worktree + branch. */
  worktree?: WorktreeInfo
  exited: boolean
  exitCode?: number
  startedAt: number
  hookStatus?: HookStatus
  /** Last notification text from Claude, e.g. "Claude needs your permission to use Bash". */
  statusMessage?: string
}

export type AgentLayout = 'tabs' | 'grid'
export type View = 'home' | 'project' | 'projects' | 'agents' | 'search' | 'usage' | 'tasks' | 'notebook' | 'knowledge'

export interface LaunchOptions {
  cwd: string
  projectName: string
  projectPath?: string
  title: string
  kind?: 'claude' | 'shell'
  args?: string[]
  worktree?: WorktreeInfo
}
