import type { ProjectIcon } from './projectLook'
export interface Project {
  /** Folder name under ~/.claude/projects (encoded path). Empty for manually added projects with no sessions yet. */
  key: string
  /** Real working directory, read from session files (falls back to a decoded guess). */
  path: string
  /** Every ~/.claude/projects folder whose chats belong here: the project's own plus its worktrees'. */
  keys: string[]
  /** What the app shows: your own name, else the README's title, else the folder name. */
  name: string
  /** The folder's own name, e.g. "WBP". */
  folderName: string
  /** First line of the README, or your own note. */
  description?: string
  /** Lucide icon name (see PROJECT_ICONS); picked automatically unless you chose one. */
  icon: ProjectIcon
  /** Avatar hue in degrees. */
  hue: number
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
  /** Your own name for the project; replaces the automatic one. */
  displayName?: string
  /** Your own icon and color; replace the automatic ones. */
  icon?: ProjectIcon
  hue?: number
  /** Sidebar section, e.g. "Work" or "Trading". */
  group?: string
  tags: string[]
  status?: ProjectStatus
  /** Free-form Markdown notes. */
  notes: string
  /** Command run after a headless task finishes, e.g. "npm test". Exit code 0 = passed. */
  checkCommand?: string
  /** Estimated monthly spend (USD, at API prices) after which automation for this project holds. */
  monthlyBudgetUsd?: number
  /** Model for new chats and tasks in this project ("opus", "sonnet", "haiku"); unset = Claude's default. */
  defaultModel?: string
  /** MCP servers loaded for agents Mission Control starts here; unset = all of them. */
  mcpAllow?: string[]
  /** Have Claude update the docs vault after each compaction (session briefing). */
  autoDocs?: boolean
}

export interface GitInitPreview {
  alreadyRepo: boolean
  /** Files that would go into the first commit (relative paths, first 200). */
  files: string[]
  fileCount: number
  totalBytes: number
  /** Files over 50 MB that would be committed. */
  large: { path: string; bytes: number }[]
  /** Files that look secret and are kept out by the ignore rules. */
  secretsExcluded: string[]
  gitignoreExists: boolean
  /** Lines that would be added to .gitignore. */
  gitignoreAdditions: string[]
}

export interface BudgetState {
  budget: number
  /** Estimated spend this calendar month, including the project's worktrees. */
  spent: number
  ratio: number
  over: boolean
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
  /** Readable worktree name when the chat ran in a Claude Code worktree of the project, e.g. "semester schedule planning". */
  worktree?: string
  /** True when you renamed this chat in Mission Control. */
  renamed?: boolean
  /** Set when the chat started in another folder (e.g. "C: drive") but is shown under this project. */
  movedFrom?: string
  /** True when you moved it here yourself, false when it was matched automatically. */
  movedByYou?: boolean
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

/** A Markdown note in a project's docs vault (docs/ plus CLAUDE.md, README.md…). */
export interface VaultNote {
  path: string
  /** Path from the project folder, with forward slashes. */
  rel: string
  /** File name without .md. */
  name: string
  title: string
  /** Folder from the project folder ('' for the project root). */
  folder: string
  mtime: number
  size: number
  tags: string[]
  /** Notes this one links to (rel paths). */
  links: string[]
  /** Link targets that match no note. */
  unresolved: string[]
  /** Written by Claude for the vault (frontmatter "generated: claude"). */
  generated: boolean
}

export interface VaultInfo {
  projectPath: string
  notes: VaultNote[]
  /** docs/INDEX.md exists: the vault has been built. */
  hasIndex: boolean
  /** CLAUDE.md points Claude at docs/INDEX.md. */
  claudeMdLinked: boolean
  /** Newest change to a Claude-written note (ms), 0 if none. */
  updatedAt: number
}

export interface DocFile {
  /** Changes when the file changed on disk, so viewers re-read it. */
  version?: number
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
  view?: 'home' | 'project' | 'projects' | 'agents' | 'search' | 'usage' | 'tasks' | 'notebook' | 'knowledge'
  layout?: 'tabs' | 'grid'
  showWorktrees?: boolean
  /** Sidebar shrunk to an icon rail. */
  sidebarCollapsed?: boolean
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
  /** Result of the project's check command after the run. */
  checks?: CheckResult
  /** Cost of earlier turns, before the current follow-up (internal). */
  costBefore?: number
  followUps?: number
  /** Commit made automatically from the run's worktree changes. */
  commit?: string
}

export interface CheckResult {
  command: string
  status: 'running' | 'passed' | 'failed' | 'error'
  exitCode?: number
  /** Last part of the combined output. */
  output: string
  startedAt: number
  finishedAt?: number
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
  /** Waiting in the auto-queue (headless To do tasks only). */
  queued?: boolean
  /** Tasks that must succeed before this one runs. */
  dependsOn?: string[]
  /** What happens when all dependencies have succeeded (default: start). */
  whenReady?: 'start' | 'queue' | 'none'
  /** The template this task was made from, if any. */
  templateId?: string
  /** When it's due (local time, ms). Without a time of day it's set to 9:00. */
  dueAt?: number
  /** Whether the user picked a time of day, or only a date. */
  dueHasTime?: boolean
  /** When the due reminder was shown, so it shows once. */
  remindedAt?: number
}

/** A compaction summary: what Claude Code wrote to carry on when a chat ran out of room. */
export interface Briefing {
  sessionId: string
  /** When the chat was compacted (ms). */
  at: number
  /** "auto" (the chat hit its limit) or "manual" (/compact). */
  trigger: string
  /** Chat size before compacting, in tokens. */
  preTokens: number
  title: string
  /** The project it belongs to (worktree chats and chats started from C:\ count as their project). */
  projectPath: string
  projectName: string
  /** The summary as Claude wrote it. */
  text: string
  /** The chat's .jsonl file. */
  transcript?: string
  /** Where Mission Control saved it, if it did. */
  savedPath?: string
}

/** A note of your own in the Notebook (project notes live in ProjectMeta.notes). */
export interface Note {
  id: string
  title: string
  /** Markdown. */
  body: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
}

/** A doc file in some project, for the Knowledge page. */
export interface KnowledgeDoc extends DocFile {
  projectPath: string
  projectName: string
  /** The first "# heading", if any. */
  title: string
  size: number
  mtime: number
}

export interface KnowledgeHit {
  doc: KnowledgeDoc
  /** Up to three matching lines. */
  snippets: { line: number; text: string }[]
}

/** Claude Code on this computer: installed, version, logged in. */
export interface ClaudeStatus {
  installed: boolean
  version?: string
  loggedIn: boolean
  authMethod?: string
  /** "pro", "max", … */
  plan?: string
}

// ---------------------------------------------------------------- templates & schedules

/**
 * When a recurring template fires. Times are local, "HH:MM".
 * hourly: every `everyHours` hours; daily: every day; weekdays: Mon-Fri; weekly: on `weekday` (0 = Sunday).
 */
export interface Schedule {
  enabled: boolean
  kind: 'hourly' | 'daily' | 'weekdays' | 'weekly'
  time: string
  weekday?: number
  everyHours?: number
  /** What to do with the new task: start it, put it in the queue, or just add it to To do. */
  then: 'start' | 'queue' | 'todo'
  lastRunAt?: number
  nextRunAt?: number
}

export interface TaskTemplate {
  id: string
  name: string
  /** Title and prompt may use {{project}}, {{date}}, {{time}} and {{weekday}}. */
  title: string
  prompt: string
  /** Fixed project; recurring templates need one. */
  projectPath?: string
  projectName?: string
  mode: TaskMode
  permission: TaskPermission
  useWorktree: boolean
  budgetUsd?: number
  model?: string
  schedule?: Schedule
  /** Pipeline: more steps that each run after the previous one succeeds (same project and settings). */
  steps?: { title: string; prompt: string }[]
  createdAt: number
  updatedAt: number
}

export type TemplateInput = Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt'>

export type UpdateState =
  | { state: 'idle' | 'checking' | 'none' | 'disabled'; version?: string; message?: string }
  | { state: 'available' | 'downloading'; version: string; percent?: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export type NewTask = Pick<Task, 'title' | 'prompt' | 'projectPath' | 'projectName' | 'mode' | 'permission' | 'useWorktree' | 'budgetUsd' | 'model' | 'dueAt' | 'dueHasTime'> & {
  queued?: boolean
  templateId?: string
  dependsOn?: string[]
  whenReady?: Task['whenReady']
}

/** Plan rate-limit utilization reported by Claude Code (0-1 per window). */
/** Where a plan window is heading at the current pace. */
export interface PaceForecast {
  /** Share of the limit used per hour (0–1 scale). */
  ratePerHour: number
  /** Projected utilization when the window resets (can pass 1). */
  atReset: number
  /** When it runs out at this pace, if that's before the reset; 0 otherwise. */
  runsOutAt: number
  /** "recent": from the last hour of readings; "window": the average since the window started. */
  basis: 'recent' | 'window'
}

export interface RateLimitInfo {
  at: number
  status: string
  /** utilization is 0–1; resetsAt is epoch ms (0 when unknown). */
  windows: { name: string; utilization: number; resetsAt: number; forecast?: PaceForecast }[]
  /** "plan": polled from your Claude account; "task": reported by a headless task run. */
  source?: 'plan' | 'task'
  /** Subscription from Claude Code's login, e.g. "pro" or "max". */
  plan?: string
  /** Pay-as-you-go credits used once plan limits run out. */
  extraUsage?: { enabled: boolean; usedUsd: number; limitUsd: number }
  /** Why the latest refresh failed; the windows are then the last good ones. */
  error?: string
}

export interface AppSettings {
  /** Accelerator for the global show/hide hotkey, e.g. "Ctrl+Alt+M"; empty to disable. */
  hotkey: string
  /** Keep running in the tray when the window closes while agents or tasks are running. */
  closeToTray: boolean
  /** Auto-queue: start queued headless tasks by themselves. */
  queueEnabled: boolean
  /** How many queued tasks may run at the same time. */
  queueParallel: number
  /** Hold the queue while any plan window is at or above this percentage (0 disables the check). */
  queuePauseAtPercent: number
  /** Check for app updates at startup and every few hours. */
  autoUpdate: boolean
  /** Spending cap (USD) for headless tasks that don't set their own; 0 = none. */
  defaultTaskBudgetUsd: number
  /** Model for tasks that don't pick one and whose project has no default; '' = Claude's default. */
  defaultTaskModel: string
  /** Notify when one chat's estimated cost today passes this (USD); 0 = off. */
  chatCostAlertUsd: number
  /** Notify when the session or weekly plan limit passes this percentage (and again when it's used up); 0 = off. */
  planAlertPercent: number
  /** A live chat turns amber (and you get one reminder) at this many tokens of context. */
  contextWarnTokens: number
  /** Your own key combinations by shortcut id ('' turns one off); missing ids use the defaults. */
  keybindings: Record<string, string>
  theme: 'dark' | 'light' | 'system'
  /** Zoom factor for the whole window, 0.7 to 1.6. */
  uiZoom: number
  /** Your name for the Home greeting; empty = the first name of your Windows account. */
  userName: string
  /** Save each compaction summary as a session briefing in the project's docs/briefings/. */
  autoBriefings: boolean
}

/** How big a live chat's context is: every reply re-reads all of it. */
export interface ContextUsage {
  sessionId: string
  /** Tokens in the conversation as of Claude's latest reply. */
  tokens: number
  model: string
  /** The model's context window. */
  window: number
  /** Estimated cost of re-reading the context once (one more reply), at API cache-read prices. */
  perTurnUsd: number
}

export interface McpServerInfo {
  name: string
  /** Where it's configured: your user config, this project in your user config, or the project's .mcp.json. */
  scope: 'user' | 'local' | 'project'
  /** "stdio" (a local program) or "http"/"sse" (a URL). */
  kind: string
  /** The command or URL, for recognizing it. */
  detail: string
  /** Whether agents Mission Control starts in this project load it. */
  enabled: boolean
}

/** What a new chat in a project carries before you type anything. */
export interface StartupReport {
  /** Measured from this project's recent chats: context size of the first reply. */
  measured?: { medianTokens: number; samples: number; model: string; firstTurnUsd: number }
  /** Instruction and memory files Claude Code loads, with estimated tokens. */
  files: { label: string; path: string; tokens: number }[]
  servers: McpServerInfo[]
  /** True when only some servers are loaded here (Mission Control passes --strict-mcp-config). */
  restricted: boolean
}

export interface QueueStatus {
  enabled: boolean
  parallel: number
  queued: number
  running: number
  /** Why the queue isn't starting tasks right now, if it isn't. */
  heldBecause?: string
}

export interface MissionControlApi {
  listProjects(): Promise<Project[]>
  /** Pass a project's `keys` to include chats from its worktrees. */
  listSessions(projectKey: string | string[], projectPath?: string): Promise<SessionSummary[]>
  /** Shows a chat under another project; an empty path goes back to automatic matching. */
  moveSession(sessionId: string, projectPath: string): Promise<void>
  /** Your own title for a chat (stored by Mission Control); empty clears it. */
  renameSession(sessionId: string, title: string): Promise<void>
  getSession(projectKey: string, sessionId: string): Promise<SessionDetail>
  addProject(): Promise<string | null>
  /** Asks for a folder in a native dialog; null if cancelled. */
  pickFolder(title?: string): Promise<string | null>
  createProject(opts: { parent: string; name: string; claudeMd: boolean; git: boolean }): Promise<string>
  /** A fresh temp folder for a throwaway chat. */
  quickChatFolder(): Promise<string>
  listNotes(): Promise<Note[]>
  saveNote(note: Partial<Note>): Promise<Note>
  deleteNote(id: string): Promise<void>
  knowledgeDocs(): Promise<KnowledgeDoc[]>
  searchKnowledge(query: string): Promise<KnowledgeHit[]>
  claudeStatus(force?: boolean): Promise<ClaudeStatus>
  /** Your first name for the greeting ('' if unknown). */
  userName(): Promise<string>
  listBriefings(): Promise<Briefing[]>
  /** Saves a briefing as a file (for older ones); returns the path. */
  saveBriefing(sessionId: string, at: number): Promise<string>
  /** The newest briefing file for a project, or null. */
  latestBriefing(projectPath: string): Promise<string | null>
  hasSummaryInstructions(projectPath: string): Promise<boolean>
  /** Adds "Summary instructions" to the project's CLAUDE.md so compaction writes a proper handoff. */
  addSummaryInstructions(projectPath: string): Promise<void>
  /** Folder names of Desktop and Documents, for New project. */
  commonFolders(): Promise<{ desktop: string; documents: string; home: string }>
  removeProject(path: string): Promise<void>
  togglePin(path: string): Promise<void>
  listDocs(projectPath: string): Promise<DocFile[]>
  /** Every note in the project's docs vault, with links resolved. */
  vaultNotes(projectPath: string): Promise<VaultInfo>
  /** Has Claude build (or update) the vault as a headless task; returns the task. */
  buildVault(projectPath: string, projectName: string, mode: 'build' | 'update', model?: string): Promise<Task>
  /** Watches one project's vault (null stops); vault:changed fires when its notes change. */
  watchVault(projectPath: string | null): void
  onVaultChanged(cb: (projectPath: string) => void): () => void
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
  search(query: string, opts?: { projectKey?: string | string[]; role?: 'user' | 'assistant'; limit?: number }): Promise<SearchHit[]>
  usageReport(sinceMs: number): Promise<UsageReport>
  /** Per-session estimated cost and tokens for one project (from the index). */
  sessionUsage(projectKey: string | string[]): Promise<Record<string, UsageTotals>>
  indexStatus(): Promise<IndexStatus>
  reindex(): void
  onIndexStatus(cb: (s: IndexStatus) => void): () => void
  listTasks(): Promise<Task[]>
  createTask(t: NewTask): Promise<Task>
  updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'prompt' | 'column' | 'order' | 'permission' | 'useWorktree' | 'budgetUsd' | 'model' | 'mode' | 'queued' | 'dueAt' | 'dueHasTime'>>): Promise<void>
  /** Continues a finished headless task's chat with a new prompt, in the background. */
  followUpTask(id: string, prompt: string): Promise<void>
  /** Runs the project's check command again for a finished task. */
  rerunChecks(id: string): Promise<void>
  previewGitInit(folder: string): Promise<GitInitPreview>
  initGit(folder: string): Promise<{ commit: string; files: number }>
  /** Monthly budget state of every project that has a budget, keyed by lower-cased project path. */
  budgets(): Promise<Record<string, BudgetState>>
  onBudgetsChanged(cb: () => void): () => void
  queueStatus(): Promise<QueueStatus>
  onQueueStatus(cb: (s: QueueStatus) => void): () => void

  listTemplates(): Promise<TaskTemplate[]>
  saveTemplate(t: TemplateInput, id?: string): Promise<TaskTemplate>
  deleteTemplate(id: string): Promise<void>
  /** Makes a task from a template now (and starts or queues it per the template's schedule setting when asked). */
  runTemplate(id: string, then: 'start' | 'queue' | 'todo', projectPath?: string): Promise<Task>
  onTemplatesChanged(cb: (t: TaskTemplate[]) => void): () => void
  /** The main process asks the UI to open an interactive task's agent (e.g. a recurring one fired). */
  onLaunchTask(cb: (taskId: string) => void): () => void

  appVersion(): Promise<string>
  updateStatus(): Promise<UpdateState>
  checkForUpdates(): Promise<void>
  installUpdate(): void
  onUpdateStatus(cb: (s: UpdateState) => void): () => void
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
  /** Asks your Claude account for the latest plan-limit numbers now. */
  refreshRateLimit(): Promise<RateLimitInfo | null>
  /** Live agent counts, shown in the tray tooltip and menu. */
  reportStatus(summary: { agents: number; attention: number }): void

  getSettings(): Promise<AppSettings>
  /** Sets the window's zoom factor right away (not saved; save uiZoom in settings for that). */
  setZoom(factor: number): void
  /** Applies settings; resolves with an error message if the hotkey can't be registered. */
  setSettings(patch: Partial<AppSettings>): Promise<string | null>
  /** Main process asks the UI to go somewhere (tray menu, hotkey). */
  onNavigate(cb: (target: { view: string; newTask?: boolean; taskId?: string; chat?: { projectPath: string; sessionId: string } }) => void): () => void
  /** Context size of live chats, by session id (chats without a reply yet are left out). */
  contextUsage(sessionIds: string[]): Promise<Record<string, ContextUsage>>
  startupReport(projectPath: string, keys: string[]): Promise<StartupReport>

  getUiState(): Promise<UiState>
  setUiState(patch: Partial<UiState>): void

  /** True while the self-test runs (MC_SMOKE); the UI then exposes a small test handle. */
  smoke: boolean
}
