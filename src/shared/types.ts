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
  /** True for Claude Code worktrees, desktop scratch workspaces and temp folders; hidden by default. */
  worktree: boolean
  meta: ProjectMeta
}

export type ProjectStatus = 'active' | 'paused' | 'done'

/** The user's own organization of a project, kept in the app's store. */
export interface ProjectMeta {
  /** Sidebar section, e.g. "Work" or "Trading". */
  group?: string
  tags: string[]
  status?: ProjectStatus
  /** Free-form Markdown notes. */
  notes: string
}

/** Token totals; cost is an estimate at Anthropic API list prices. */
export interface UsageTotals {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  cost: number
  sessions?: number
}

export interface UsageReport {
  /** Since this time (ms); 0 for all time. */
  since: number
  totals: UsageTotals
  byDay: (UsageTotals & { day: string })[]
  byProject: (UsageTotals & { projectKey: string; projectPath: string })[]
  byModel: (UsageTotals & { model: string })[]
  topSessions: (UsageTotals & { sessionId: string; projectKey: string; projectPath: string; title: string; updated: number })[]
}

export interface SearchHit {
  sessionId: string
  projectKey: string
  projectPath: string
  title: string
  role: 'user' | 'assistant'
  /** Text with matches wrapped in \u0001 … \u0002. */
  snippet: string
  timestamp: number
}

export interface IndexStatus {
  indexing: boolean
  done: number
  total: number
  sessions: number
  messages: number
  lastRun: number
  error?: string
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
  worktree?: WorktreeInfo
  projectPath?: string
}

export interface GitInfo {
  isRepo: boolean
  /** Top folder of this checkout (a worktree's own folder for worktrees). */
  root?: string
  branch?: string
  /** Number of changed + untracked files. */
  dirty?: number
  ahead?: number
  behind?: number
  isWorktree?: boolean
  /** Folder of the main checkout (same as root unless this is a worktree). */
  mainRoot?: string
}

/** A worktree + branch created by the app for one agent. */
export interface WorktreeInfo {
  path: string
  branch: string
  /** Branch it was created from and will be merged back into. */
  base: string
  repoRoot: string
}

export interface ChangedFile {
  path: string
  /** git name-status letter; '?' for untracked. */
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'
  staged: boolean
}

export interface GitChanges {
  files: ChangedFile[]
  /** Unified diff of all changes, untracked files included as new files. */
  diff: string
  /** One-line summaries of commits on this branch since base (worktrees only). */
  commits: string[]
  base: string
}

/** UI state remembered between runs. */
export interface UiState {
  selectedPath?: string
  view?: 'home' | 'project' | 'agents' | 'search' | 'usage' | 'tasks'
  layout?: 'tabs' | 'grid'
  showWorktrees?: boolean
}

export interface RecentSession extends SessionSummary {
  projectName: string
  projectPath: string
}

// ---------------------------------------------------------------- tasks

export type TaskColumn = 'todo' | 'running' | 'review' | 'done'
/** Headless runs `claude -p` in the background; interactive opens a normal agent terminal. */
export type TaskMode = 'headless' | 'interactive'
export type TaskPermission = 'auto' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface TaskEvent {
  at: number
  kind: 'start' | 'tool' | 'text' | 'result' | 'error' | 'info'
  text: string
}

export interface TaskRun {
  sessionId?: string
  startedAt: number
  finishedAt?: number
  /** One line describing what the agent is doing right now, e.g. "Editing src/app.ts". */
  activity?: string
  toolCalls: number
  turns?: number
  costUsd?: number
  /** Final answer of a headless run. */
  result?: string
  error?: string
  /** Recent events, newest last (capped). */
  events: TaskEvent[]
  /** Interactive runs: the agent (PTY) id while it's open. */
  agentId?: string
}

export interface Task {
  id: string
  title: string
  /** The prompt given to Claude. */
  prompt: string
  projectPath: string
  projectName: string
  column: TaskColumn
  mode: TaskMode
  permission: TaskPermission
  /** Run in its own git worktree + branch. */
  useWorktree: boolean
  /** Spending cap for headless runs (USD), passed as --max-budget-usd. */
  budgetUsd?: number
  model?: string
  createdAt: number
  updatedAt: number
  /** Position within its column (lower first). */
  order: number
  worktree?: WorktreeInfo
  run?: TaskRun
}

export type NewTask = Pick<Task, 'title' | 'prompt' | 'projectPath' | 'projectName' | 'mode' | 'permission' | 'useWorktree' | 'budgetUsd' | 'model'>

/** Plan rate-limit utilization reported by Claude Code (0-1 per window). */
export interface RateLimitInfo {
  at: number
  status: string
  windows: { name: string; utilization: number; resetsAt: number }[]
}

export interface AppSettings {
  /** Accelerator for the global show/hide hotkey, e.g. "Ctrl+Alt+M"; empty to disable. */
  hotkey: string
  /** Keep running in the tray when the window closes while agents or tasks are running. */
  closeToTray: boolean
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

  recentSessions(limit: number): Promise<RecentSession[]>
  gitInfoMany(paths: string[]): Promise<Record<string, GitInfo>>
  createWorktree(projectPath: string): Promise<WorktreeInfo>
  getChanges(path: string, base?: string): Promise<GitChanges>
  commitAll(path: string, message: string): Promise<void>
  mergeWorktree(wt: WorktreeInfo): Promise<string>
  /** Asks the user in a native dialog first; resolves false if they cancel. */
  removeWorktree(wt: WorktreeInfo): Promise<boolean>
  setProjectMeta(path: string, patch: Partial<ProjectMeta>): Promise<void>
  search(query: string, opts?: { projectKey?: string; role?: 'user' | 'assistant'; limit?: number }): Promise<SearchHit[]>
  usageReport(sinceMs: number): Promise<UsageReport>
  /** Per-session estimated cost and tokens for one project (from the index). */
  sessionUsage(projectKey: string): Promise<Record<string, UsageTotals>>
  indexStatus(): Promise<IndexStatus>
  reindex(): void
  onIndexStatus(cb: (s: IndexStatus) => void): () => void
  listTasks(): Promise<Task[]>
  createTask(t: NewTask): Promise<Task>
  updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'prompt' | 'column' | 'order' | 'permission' | 'useWorktree' | 'budgetUsd' | 'model' | 'mode'>>): Promise<void>
  deleteTask(id: string): Promise<void>
  /**
   * Starts a task. Headless tasks run in the main process. For interactive tasks the main process
   * prepares the folder (and worktree) and returns how to launch the agent, which the UI then opens.
   */
  startTask(id: string): Promise<{ interactive?: { cwd: string; args: string[]; worktree?: WorktreeInfo } }>
  stopTask(id: string): Promise<void>
  /** Records the interactive agent a task runs in (or its finish). */
  setTaskRun(id: string, patch: Partial<TaskRun>, column?: TaskColumn): Promise<void>
  onTasksChanged(cb: (tasks: Task[]) => void): () => void
  onRateLimit(cb: (info: RateLimitInfo) => void): () => void
  getRateLimit(): Promise<RateLimitInfo | null>
  /** Live agent counts, shown in the tray tooltip and menu. */
  reportStatus(summary: { agents: number; attention: number }): void

  getSettings(): Promise<AppSettings>
  /** Applies settings; resolves with an error message if the hotkey can't be registered. */
  setSettings(patch: Partial<AppSettings>): Promise<string | null>
  /** Main process asks the UI to go somewhere (tray menu, hotkey). */
  onNavigate(cb: (target: { view: string; newTask?: boolean }) => void): () => void

  getUiState(): Promise<UiState>
  setUiState(patch: Partial<UiState>): void

  /** True while the self-test runs (MC_SMOKE); the UI then exposes a small test handle. */
  smoke: boolean
}
