import {
  ArrowRightLeft,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Download,
  FileStack,
  FolderOpen,
  FolderPlus,
  GitFork,
  Hexagon,
  History,
  House,
  Inbox,
  KanbanSquare,
  Keyboard,
  LayoutGrid,
  Leaf,
  ListPlus,
  MessageSquareDashed,
  NotebookPen,
  PanelLeft,
  Play,
  RefreshCw,
  RotateCcw,
  Rows2,
  Send,
  Settings,
  SunMoon,
  Terminal,
  TextSearch,
  PenLine,
  Wand2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { AppSettings, Project, RecentSession, UpdateState, Workspace } from '@shared/types'
import type { Command } from '../components/CommandPalette'
import type { Agent, AgentLayout, LaunchOptions, View } from '../types'
import type { useToast } from '../toast'

/** Everything the palette's commands read or call; App passes its current state and actions. */
export interface CommandContext {
  setView: (view: View) => void
  runShortcut: (id: string) => void
  keyOf: (id: string) => string
  toast: ReturnType<typeof useToast>
  workspaces: Workspace[]
  openWorkspace: (ws: Workspace) => Promise<void>
  openWorkspaces: () => void
  appSettings: AppSettings | null
  update: UpdateState
  selected: Project | null
  newInSelected: () => void
  launchWorktree: (project: Project) => void
  /** Starts the other agent from a handoff of the newest chat by `from` (ADR 0020). */
  handOff: (projectPath: string, from: 'claude' | 'codex', to: 'claude' | 'codex') => void
  launch: (opts: LaunchOptions) => unknown
  layout: AgentLayout
  setLayout: (layout: AgentLayout) => void
  notify: boolean
  toggleNotify: () => void
  addProject: () => void
  refreshProjects: () => void
  agents: Agent[]
  focusAgent: (id: string) => void
  projects: Project[]
  showWorktrees: boolean
  openProject: (path: string) => void
  recentForPalette: RecentSession[]
  resumeRecent: (s: RecentSession) => void
  openNewProject: () => void
  openComposer: () => void
  openTemplates: () => void
  openSettings: () => void
  openShortcuts: () => void
}

/** The command palette's list: pages, actions, open agents, projects and recent chats. */
export function paletteCommands(c: CommandContext): Command[] {
  const { setView, runShortcut, selected, launch, layout } = c
  const list: Command[] = [
    { id: 'go-home', group: 'Go to', title: 'Home', icon: House, run: () => setView('home') },
    { id: 'go-inbox', group: 'Go to', title: 'Inbox (needs you) and daily digest', icon: Inbox, keywords: 'attention waiting review notifications digest', run: () => setView('inbox') },
    { id: 'go-agents', group: 'Go to', title: 'Agents', icon: Bot, run: () => setView('agents') },
    { id: 'broadcast', group: 'Actions', title: 'Send a prompt to several agents…', icon: Send, keywords: 'broadcast all agents message briefing', run: () => runShortcut('broadcast') },
    { id: 'save-workspace', group: 'Actions', title: 'Save or manage workspaces…', icon: LayoutGrid, keywords: 'workspace layout save agents set', run: c.openWorkspaces },
    ...c.workspaces.map((w) => ({ id: `ws-${w.id}`, group: 'Workspaces', title: `Open workspace: ${w.name}`, hint: `${w.agents.length} agents`, icon: LayoutGrid, keywords: w.agents.map((a) => a.title).join(' '), run: () => void c.openWorkspace(w) })),
    { id: 'go-search', group: 'Go to', title: 'Search all chats', hint: 'Ctrl+Shift+F', icon: TextSearch, keywords: 'find full text', run: () => setView('search') },
    { id: 'go-usage', group: 'Go to', title: 'Usage and cost', icon: BarChart3, keywords: 'tokens stats spend', run: () => setView('usage') },
    { id: 'go-tasks', group: 'Go to', title: 'Task board', icon: KanbanSquare, keywords: 'kanban todo', run: () => setView('tasks') },
    { id: 'go-projects', group: 'Go to', title: 'All projects', icon: FolderOpen, keywords: 'cards folders', run: () => setView('projects') },
    { id: 'go-notebook', group: 'Go to', title: 'Notebook', icon: NotebookPen, keywords: 'notes write', run: () => setView('notebook') },
    { id: 'go-knowledge', group: 'Go to', title: 'Knowledge (all docs)', icon: BookOpen, keywords: 'docs readme claude.md', run: () => setView('knowledge') },
    { id: 'go-prompts', group: 'Go to', title: 'Prompt Studio', icon: PenLine, keywords: 'prompt generator write prompt claude codex', run: () => setView('prompts') },
    { id: 'go-skills', group: 'Go to', title: 'Skills', icon: Wand2, keywords: 'skills plugins slash commands', run: () => setView('skills') },
    { id: 'toggle-eco', group: 'View', title: c.appSettings?.eco?.enabled ? 'Turn Eco mode off' : 'Turn Eco mode on', icon: Leaf, keywords: 'eco save usage credits tokens cheaper', run: () => runShortcut('toggleEco') },
    { id: 'new-project', group: 'Actions', title: 'New project…', icon: FolderPlus, keywords: 'create folder', run: c.openNewProject },
    { id: 'quick-chat', group: 'Actions', title: 'Quick chat', icon: MessageSquareDashed, keywords: 'temporary scratch', run: () => runShortcut('quickChat') },
    { id: 'new-note', group: 'Actions', title: 'New note', icon: NotebookPen, keywords: 'notebook write', run: () => runShortcut('newNote') },
    { id: 'new-task', group: 'Actions', title: 'New task…', icon: ListPlus, keywords: 'kanban headless background', run: c.openComposer },
    { id: 'templates', group: 'Actions', title: 'Task templates and schedules', icon: FileStack, keywords: 'recurring cron repeat', run: c.openTemplates },
    { id: 'settings', group: 'Actions', title: 'Settings', icon: Settings, keywords: 'hotkey shortcut tray', run: c.openSettings },
    {
      id: 'update',
      group: 'Actions',
      title: c.update.state === 'ready' ? `Restart to update to ${c.update.version}` : c.update.state === 'available' || c.update.state === 'downloading' ? `Update to ${c.update.version}` : 'Check for updates',
      icon: Download,
      keywords: 'update upgrade new version release',
      run: () => {
        if (c.update.state === 'ready' || c.update.state === 'available' || c.update.state === 'downloading') return window.mc.updateNow()
        void window.mc.checkForUpdates()
        c.toast('info', 'Checking for updates', c.update.state === 'disabled' ? 'Updates only work in the installed app.' : 'If there is one, an Update button appears in the top bar.')
      }
    },
    { id: 'shortcuts', group: 'Actions', title: 'Keyboard shortcuts', icon: Keyboard, keywords: 'keys hotkeys bindings', run: c.openShortcuts },
    { id: 'toggleSidebar', group: 'View', title: 'Show or hide sidebar', icon: PanelLeft, run: () => runShortcut('toggleSidebar') },
    { id: 'toggleTheme', group: 'View', title: 'Light or dark theme', icon: SunMoon, keywords: 'appearance colors', run: () => runShortcut('toggleTheme') },
    { id: 'zoomIn', group: 'View', title: 'Zoom in', icon: ZoomIn, keywords: 'bigger text size', run: () => runShortcut('zoomIn') },
    { id: 'zoomOut', group: 'View', title: 'Zoom out', icon: ZoomOut, keywords: 'smaller text size', run: () => runShortcut('zoomOut') },
    { id: 'zoomReset', group: 'View', title: 'Reset zoom', icon: ZoomIn, run: () => runShortcut('zoomReset') }
  ]
  if (selected) {
    list.push(
      { id: 'new', group: 'Actions', title: `New Claude session in ${selected.name}`, icon: Play, run: c.newInSelected },
      {
        id: 'new-codex',
        group: 'Actions',
        title: `New Codex session in ${selected.name}`,
        icon: Hexagon,
        keywords: 'openai gpt codex cli',
        run: () => launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · Codex`, kind: 'codex' })
      },
      { id: 'handoff-codex', group: 'Actions', title: `Hand ${selected.name} to Codex`, icon: ArrowRightLeft, keywords: 'continue from claude handoff codex', run: () => c.handOff(selected.path, 'claude', 'codex') },
      { id: 'handoff-claude', group: 'Actions', title: `Hand ${selected.name} to Claude`, icon: ArrowRightLeft, keywords: 'continue from codex handoff claude', run: () => c.handOff(selected.path, 'codex', 'claude') },
      { id: 'new-wt', group: 'Actions', title: `New session in a worktree of ${selected.name}`, icon: GitFork, keywords: 'branch parallel', run: () => c.launchWorktree(selected) },
      {
        id: 'continue',
        group: 'Actions',
        title: `Continue last chat in ${selected.name}`,
        icon: RotateCcw,
        run: () => launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · continued`, args: ['--continue'] })
      },
      {
        id: 'shell',
        group: 'Actions',
        title: `PowerShell in ${selected.name}`,
        icon: Terminal,
        run: () => launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · shell`, kind: 'shell' })
      }
    )
  }
  list.push(
    { id: 'layout', group: 'Actions', title: layout === 'tabs' ? 'Show agents in a grid' : 'Show agents as tabs', icon: layout === 'tabs' ? LayoutGrid : Rows2, run: () => c.setLayout(layout === 'tabs' ? 'grid' : 'tabs') },
    { id: 'notify', group: 'Actions', title: c.notify ? 'Turn notifications off' : 'Turn notifications on', icon: Bell, run: c.toggleNotify },
    { id: 'add', group: 'Actions', title: 'Add a project folder…', icon: FolderPlus, run: c.addProject },
    { id: 'refresh', group: 'Actions', title: 'Refresh projects', icon: RefreshCw, run: c.refreshProjects }
  )
  for (const a of c.agents.filter((x) => !x.exited)) {
    list.push({ id: `agent-${a.id}`, group: 'Agents', title: a.title, hint: a.projectName, icon: Bot, run: () => c.focusAgent(a.id) })
  }
  for (const p of c.projects.filter((x) => c.showWorktrees || !x.worktree)) {
    list.push({ id: `proj-${p.path}`, group: 'Projects', title: p.name, hint: p.path, icon: FolderOpen, keywords: p.path, run: () => c.openProject(p.path) })
  }
  // Show each command's shortcut.
  const shortcutOf: Record<string, string> = {
    'go-home': 'goHome', 'go-inbox': 'goInbox', 'go-projects': 'goProjects', 'go-notebook': 'goNotebook', 'go-knowledge': 'goKnowledge',
    'new-project': 'newProject', 'quick-chat': 'quickChat', 'new-note': 'newNote', 'go-agents': 'goAgents', 'go-search': 'goSearch', 'go-usage': 'goUsage', 'go-tasks': 'goTasks', 'go-skills': 'goSkills', 'toggle-eco': 'toggleEco', broadcast: 'broadcast',
    'new-task': 'newTask', templates: 'templates', settings: 'settings', shortcuts: 'shortcuts', new: 'newSession',
    'new-wt': 'newWorktreeSession', continue: 'continueLast', shell: 'powershell', layout: 'toggleGrid', notify: 'notifications',
    add: 'addProject', refresh: 'refresh', toggleSidebar: 'toggleSidebar', toggleTheme: 'toggleTheme', zoomIn: 'zoomIn',
    zoomOut: 'zoomOut', zoomReset: 'zoomReset'
  }
  for (const cmd of list) if (shortcutOf[cmd.id]) cmd.hint = c.keyOf(shortcutOf[cmd.id]) || cmd.hint
  for (const s of c.recentForPalette) {
    list.push({ id: `chat-${s.id}`, group: 'Resume a chat', title: s.title, hint: s.projectName, icon: History, keywords: s.projectName, run: () => c.resumeRecent(s) })
  }
  return list
}
