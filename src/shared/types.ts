export interface Project {
  /** Folder name under ~/.claude/projects (encoded path). Empty for manually added projects with no sessions yet. */
  key: string
  /** Real working directory, read from session files (falls back to a decoded guess). */
  path: string
  name: string
  sessionCount: number
  lastActivity: number
  pinned: boolean
  /** True when this project only exists in the app's own store (added by hand). */
  manual: boolean
  /** True for Claude Code worktrees (.claude/worktrees/...) and desktop scratch workspaces; hidden by default. */
  worktree: boolean
}

export interface SessionSummary {
  id: string
  projectKey: string
  title: string
  firstPrompt: string
  cwd: string
  gitBranch: string
  startedAt: number
  updatedAt: number
  sizeBytes: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

export interface SessionDetail {
  summary: SessionSummary
  messages: ChatMessage[]
  truncated: boolean
}

export interface DocFile {
  name: string
  path: string
}

export interface TerminalSpec {
  cwd: string
  /** Arguments passed to the claude CLI, e.g. ['--resume', id]. */
  args: string[]
  /** 'claude' runs the Claude Code CLI, 'shell' opens a plain PowerShell. */
  kind: 'claude' | 'shell'
  cols: number
  rows: number
}

export interface TerminalInfo {
  id: string
  pid: number
  /** Session id for claude terminals: assigned via --session-id for new sessions, or the one being resumed. */
  sessionId?: string
}

/** A Claude Code hook call reported by one of the app's agents. */
export interface HookEvent {
  agentId: string
  /** hook_event_name, e.g. 'UserPromptSubmit', 'Stop', 'Notification'. */
  event: string
  sessionId?: string
  message?: string
  notificationType?: string
  /** SessionStart source: 'startup' | 'resume' | 'clear' | 'compact'. */
  source?: string
  at: number
}

/** What is remembered about an open agent so it can be reopened after a restart. */
export interface SavedAgent {
  title: string
  cwd: string
  projectName: string
  kind: 'claude' | 'shell'
  sessionId?: string
}

export interface MissionControlApi {
  listProjects(): Promise<Project[]>
  listSessions(projectKey: string): Promise<SessionSummary[]>
  getSession(projectKey: string, sessionId: string): Promise<SessionDetail>
  addProject(): Promise<string | null>
  removeProject(path: string): Promise<void>
  togglePin(path: string): Promise<void>
  listDocs(projectPath: string): Promise<DocFile[]>
  readDoc(filePath: string): Promise<string>
  writeDoc(filePath: string, content: string): Promise<void>
  openInExplorer(path: string): Promise<void>
  openInVSCode(path: string): Promise<void>
  openExternalTerminal(cwd: string, args: string[]): Promise<void>

  ptySpawn(spec: TerminalSpec): Promise<TerminalInfo>
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyKill(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, code: number) => void): () => void

  onHookEvent(cb: (event: HookEvent) => void): () => void
  saveAgents(agents: SavedAgent[]): void
  loadSavedAgents(): Promise<SavedAgent[]>
  sessionExists(sessionId: string): Promise<boolean>
  focusWindow(): void
}
