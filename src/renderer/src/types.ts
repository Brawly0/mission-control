import type { TerminalKind, WorktreeInfo } from '@shared/types'
import type { ToolActivity } from '@shared/agentActivity'

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
  kind: TerminalKind
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
  /** The tool call Claude is on (or asking permission for), from the PreToolUse hook. Cleared when the turn ends. */
  activity?: ToolActivity & { at: number }
  /** Files this agent has written to since it started, newest last (from its Edit/Write calls). */
  edited?: string[]
}

export type AgentLayout = 'tabs' | 'grid'
export type View = 'home' | 'inbox' | 'project' | 'projects' | 'agents' | 'search' | 'usage' | 'tasks' | 'notebook' | 'knowledge' | 'skills' | 'prompts'

export interface LaunchOptions {
  cwd: string
  projectName: string
  projectPath?: string
  title: string
  kind?: TerminalKind
  args?: string[]
  worktree?: WorktreeInfo
  /** Open it without switching to the Agents page (task runs show in Tasks → Terminals). */
  stayInView?: boolean
}
