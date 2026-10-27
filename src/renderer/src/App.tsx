import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, X } from 'lucide-react'
import type {
  AgentTool,
  Task,
  CodexUsage,
  GitInfo,
  IndexStatus,
  NewTask,
  Project,
  QueueStatus,
  RateLimitInfo,
  RecentSession,
  SearchHit,
  SessionSummary,
  TaskTemplate,
  UpdateState,
  BudgetState,
  PlanRate,
  WorktreeInfo
} from '@shared/types'
import TasksView from './components/TasksView'
import TaskComposer from './components/TaskComposer'
import TaskDrawer from './components/TaskDrawer'
import Sidebar from './components/Sidebar'
import HomeView from './components/HomeView'
import ProjectView from './components/ProjectView'
import AgentsView from './components/AgentsView'
import StatusBar from './components/StatusBar'
import CommandPalette, { type Command } from './components/CommandPalette'
import { Button } from './components/ui'
import type { AgentLayout, View } from './types'
import { useToast } from './toast'
import { errorMessage, shortPath } from './util'
import { LookContext, makeLookUp } from './projectLook'
import { ShortcutContext, allowedIn, bindingIndex, comboFromEvent, effectiveKeys } from './shortcuts'
import ShortcutsDialog from './components/ShortcutsDialog'
import TopBar from './components/TopBar'
import BottomDock, { type DockRequest, type DockContext } from './components/BottomDock'
import ProjectsView from './components/ProjectsView'
import NewProjectDialog from './components/NewProjectDialog'
import InboxView from './components/InboxView'
import BroadcastDialog from './components/BroadcastDialog'
import WorkspacesDialog from './components/WorkspacesDialog'
import { inboxCount, inboxItems, visibleInbox, type InboxItem } from './inbox'
import { PlanRateContext } from './planRate'
import { paletteCommands } from './app/commands'
import { runShortcutAction } from './app/shortcutActions'
import { useAppSettings } from './app/useAppSettings'
import { useAgents } from './app/useAgents'
import { useTasks } from './app/useTasks'
import { useWorkspaces } from './app/useWorkspaces'
import { briefingPrompt, worktreeParent } from '@shared/projectLook'
import { resumeArgs } from './agentStatus'
import { TOOL_NAME } from '@shared/handoff'

// Pages and dialogs most sessions never open load on first use, so they aren't part of startup.
const TemplatesDialog = lazy(() => import('./components/TemplatesDialog'))
const SettingsDialog = lazy(() => import('./components/SettingsDialog'))
const SearchView = lazy(() => import('./components/SearchView'))
const UsageView = lazy(() => import('./components/UsageView'))
const SkillsView = lazy(() => import('./components/SkillsView'))
const NotebookView = lazy(() => import('./components/NotebookView'))
const KnowledgeView = lazy(() => import('./components/KnowledgeView'))

/** Mounts a page the first time it's shown, then keeps it mounted (hidden) like the others, so it keeps its state. */
function OnceShown({ show, children }: { show: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(show)
  if (show && !seen) setSeen(true)
  return seen ? <Suspense fallback={null}>{children}</Suspense> : null
}

export default function App() {
  const toast = useToast()
  const [dockRequest, setDockRequest] = useState<DockRequest>()
  const dockNonce = useRef(0)
  const openDock = (tab: DockRequest['tab']) => setDockRequest({ tab, nonce: ++dockNonce.current })
  const [projects, setProjects] = useState<Project[]>([])
  const lookUp = useMemo(() => makeLookUp(projects), [projects])
  const [git, setGit] = useState<Record<string, GitInfo>>({})
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('home')
  const [layout, setLayout] = useState<AgentLayout>('tabs')
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [recentForPalette, setRecentForPalette] = useState<RecentSession[]>([])
  const [uiLoaded, setUiLoaded] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [taskFilter, setTaskFilter] = useState('')
  const [tasksLayout, setTasksLayout] = useState<'board' | 'terminals'>('board')
  const [terminalFocus, setTerminalFocus] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'spending' | undefined>()
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [composerInitial, setComposerInitial] = useState<Partial<NewTask> | undefined>()
  const [queue, setQueue] = useState<QueueStatus | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' })
  const [budgets, setBudgets] = useState<Record<string, BudgetState>>({})
  const [planRate, setPlanRate] = useState<PlanRate | null>(null)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [inboxDismissed, setInboxDismissed] = useState<string[]>([])
  const [showDismissed, setShowDismissed] = useState(false)

  // Monthly budgets: refresh when the index changes (new spend), when projects change (new budgets), and on warnings.
  const refreshBudgets = useCallback(() => {
    window.mc.budgets().then(setBudgets).catch(() => undefined)
  }, [])
  useEffect(() => window.mc.onBudgetsChanged(refreshBudgets), [refreshBudgets])

  useEffect(() => {
    window.mc.listTemplates().then(setTemplates)
    window.mc.queueStatus().then(setQueue)
    window.mc.updateStatus().then(setUpdate)
    const offs = [window.mc.onTemplatesChanged(setTemplates), window.mc.onQueueStatus(setQueue), window.mc.onUpdateStatus(setUpdate)]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    window.mc.getRateLimit().then(setRateLimit)
    const offRate = window.mc.onRateLimit(setRateLimit)
    // The tray menu and notifications can send the UI somewhere.
    const offNav = window.mc.onNavigate((target) => {
      setView(target.view as View)
      if (target.newTask) setComposerOpen(true)
      if (target.chat) openSessionRef.current(target.chat.projectPath, target.chat.sessionId)
      if (target.taskId) setOpenTaskId(target.taskId)
    })
    return () => {
      offRate()
      offNav()
    }
  }, [])
  const [focusSession, setFocusSession] = useState<{ sessionId: string; nonce: number } | undefined>()

  useEffect(() => {
    window.mc.indexStatus().then(setIndexStatus)
    return window.mc.onIndexStatus(setIndexStatus)
  }, [])
  const { appSettings, saveSettings, theme } = useAppSettings(settingsOpen)
  const warnAt = appSettings?.contextWarnTokens ?? 200_000

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newNoteRequest, setNewNoteRequest] = useState(0)
  const [userName, setUserName] = useState('')
  useEffect(() => {
    window.mc.userName().then(setUserName).catch(() => undefined)
  }, [settingsOpen])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutKeys = useMemo(() => effectiveKeys(appSettings?.keybindings), [appSettings?.keybindings])
  const shortcutIndex = useRef(bindingIndex(shortcutKeys))
  shortcutIndex.current = bindingIndex(shortcutKeys)
  const keyOf = (id: string) => shortcutKeys.get(id)?.[0] ?? ''
  const {
    agents,
    agentsRef,
    activeAgent,
    setActiveAgent,
    lastOutput,
    contexts,
    notify,
    toggleNotify,
    pendingRestore,
    setPendingRestore,
    restoreAll,
    launch,
    focusAgent,
    closeAgent,
    renameAgent,
    markExited,
    openSessions,
    maximizedAgent,
    setMaximizedAgent
  } = useAgents({ view, setView, toast, warnAt, writeBriefingKey: keyOf('writeBriefing'), onTurnDone: () => void refreshGit() })
  const projectsRef = useRef(projects)
  projectsRef.current = projects

  // ---------- data ----------
  const refreshGit = useCallback(async () => {
    const paths = new Set<string>()
    for (const p of projectsRef.current) if (!p.worktree || showWorktrees) paths.add(p.path)
    if (selectedPath) paths.add(selectedPath)
    for (const a of agentsRef.current) paths.add(a.projectPath)
    if (paths.size === 0) return
    const info = await window.mc.gitInfoMany([...paths])
    setGit((prev) => ({ ...prev, ...info }))
  }, [showWorktrees, selectedPath])

  // A refresh asked for while one runs (at startup the app and the index ask at once) waits for it, then runs once more.
  const projectsRun = useRef<{ running?: Promise<void>; again?: boolean }>({})
  const refreshProjects = useCallback((): Promise<void> => {
    const run = projectsRun.current
    if (run.running) {
      run.again = true
      return run.running
    }
    run.running = (async () => {
      setLoading(true)
      try {
        do {
          run.again = false
          const list = await window.mc.listProjects()
          setProjects(list)
          projectsRef.current = list
          setSelectedPath((cur) => (cur && list.some((p) => p.path === cur) ? cur : (list.find((p) => !p.worktree)?.path ?? null)))
          refreshGit()
        } while (run.again)
      } finally {
        run.running = undefined
        setLoading(false)
      }
    })()
    return run.running
  }, [refreshGit])

  useEffect(() => {
    window.mc.getUiState().then((ui) => {
      if (ui.selectedPath) setSelectedPath(ui.selectedPath)
      if (ui.view) setView(ui.view)
      if (ui.layout) setLayout(ui.layout)
      if (ui.showWorktrees) setShowWorktrees(true)
      if (ui.sidebarCollapsed) setSidebarCollapsed(true)
      if (ui.inboxDismissed) setInboxDismissed(ui.inboxDismissed)
      if (ui.tasksLayout) setTasksLayout(ui.tasksLayout)
      setUiLoaded(true)
      refreshProjects()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (uiLoaded) window.mc.setUiState({ selectedPath: selectedPath ?? undefined, view, layout, showWorktrees, sidebarCollapsed, tasksLayout })
  }, [uiLoaded, selectedPath, view, layout, showWorktrees, sidebarCollapsed, tasksLayout])

  // Keep git badges fresh: on an interval and whenever the window regains focus.
  useEffect(() => {
    void refreshGit()
    const timer = setInterval(refreshGit, 15000)
    window.addEventListener('focus', refreshGit)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refreshGit)
    }
  }, [refreshGit])

  const { tasks, tasksRef, startTask: runTask, saveAsTemplate, continueTask } = useTasks({ agents, launch, toast })
  /** Shows a task's live terminal in Tasks → Terminals. */
  const showTaskTerminal = useCallback((task: Task) => {
    setTasksLayout('terminals')
    setTerminalFocus(task.id)
  }, [])
  // Starting a task from the Tasks page brings its terminal up, so you can watch it work.
  const startTask = useCallback(async (task: Task) => {
    await runTask(task)
    if (view === 'tasks' && !task.team) showTaskTerminal(task)
  }, [runTask, showTaskTerminal, view])
  const boardTasks = useMemo(() => tasks.filter(t => !t.teamParentId), [tasks])

  const launchWorktree = useCallback(
    async (project: Project) => {
      try {
        const wt = await window.mc.createWorktree(project.path)
        toast('success', 'Worktree created', `${wt.branch} from ${wt.base}`)
        await launch({
          cwd: wt.path,
          projectName: project.name,
          projectPath: project.path,
          title: `${project.name} · ${wt.branch.replace(/^mc\//, '')}`,
          worktree: wt,
          kind: project.meta.preferredAgent ?? 'claude'
        })
      } catch (e) {
        toast('error', 'Could not create a worktree', errorMessage(e))
      }
    },
    [launch, toast]
  )



  // Self-test handle: lets smoke.ts drive a real agent through the UI and read its status.
  useEffect(() => {
    if (!window.mc.smoke) return
    ;(window as any).__mcSmoke = { launch, agents: () => agentsRef.current, setView, openPalette: () => setPaletteOpen(true), selectProject: setSelectedPath, refresh: refreshProjects, openComposer: () => setComposerOpen(true), openTask: setOpenTaskId, openTemplates: () => setTemplatesOpen(true), openSettings: () => setSettingsOpen(true), openShortcuts: () => setShortcutsOpen(true), closeAgent, runShortcut: (id: string) => runShortcutRef.current(id), startTask, tasks: () => tasksRef.current, openSession: (projectPath: string, sessionId: string) => openSessionRef.current(projectPath, sessionId) }
  }, [launch, refreshProjects, startTask, closeAgent])




  const openProject = useCallback((path: string) => {
    // Paths from the index may differ in letter case from the project list.
    // Chats from a worktree live under the worktree's project.
    const same = (p: Project, q: string) => p.path.toLowerCase() === q.toLowerCase()
    const parent = worktreeParent(path)?.parent
    const match = projectsRef.current.find((p) => same(p, path)) ?? (parent ? projectsRef.current.find((p) => same(p, parent)) : undefined)
    if (match?.worktree) setShowWorktrees(true)
    setSelectedPath(match?.path ?? path)
    setView('project')
  }, [])

  const openSession = useCallback(
    async (projectPath: string, sessionId: string) => {
      const root = worktreeParent(projectPath)?.parent ?? projectPath
      if (!projectsRef.current.some(p => p.path.toLowerCase() === root.toLowerCase())) {
        try { await window.mc.addProjectPath(root); await refreshProjects() }
        catch (e) { toast('error', 'Could not open project', errorMessage(e)); return }
      }
      openProject(projectPath)
      setFocusSession({ sessionId, nonce: Date.now() })
    },
    [openProject, refreshProjects, toast]
  )

  const openSessionRef = useRef(openSession)
  openSessionRef.current = openSession

  const groups = useMemo(() => [...new Set(projects.map((p) => p.meta.group).filter((g): g is string => !!g))].sort(), [projects])

  const addProject = useCallback(async () => {
    const path = await window.mc.addProject()
    if (path) {
      await refreshProjects()
      openProject(path)
    }
  }, [refreshProjects, openProject])

  useEffect(() => refreshBudgets(), [projects, indexStatus?.lastRun, refreshBudgets])
  // What a dollar of usage takes of your plan: refreshed with new chats and new plan readings (cached for 10 minutes in main).
  useEffect(() => {
    window.mc.planRate().then(setPlanRate).catch(() => undefined)
  }, [indexStatus?.lastRun, rateLimit?.at])
  // The index knows which project a chat started from C:\ worked in, so re-list projects when it updates.
  useEffect(() => {
    if (indexStatus?.lastRun) void refreshProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexStatus?.lastRun])

  const selected = projects.find((p) => p.path === selectedPath) ?? null
  const openTask = tasks.find((t) => t.id === openTaskId) ?? null
  const terminalAgent = agents.find(a => a.id === activeAgent)
  const sessionProject = view === 'agents' && terminalAgent ? projects.find(p => p.path.toLowerCase() === terminalAgent.projectPath.toLowerCase()) : selected
  const newInSelected = useCallback(() => {
    if (sessionProject) launch({ kind: sessionProject.meta.preferredAgent ?? 'claude', cwd: sessionProject.path, projectName: sessionProject.name, projectPath: sessionProject.path, title: `${sessionProject.name} · new` })
    else setNewProjectOpen(true)
  }, [sessionProject, launch])

  const openProjectTerminal = (p?: Project) => {
    const project = p ?? selected
    if (!project) {
      void window.mc.commonFolders().then(({ home }) => launch({ kind: 'shell', cwd: home, projectPath: home, projectName: 'Setup', title: 'Setup terminal' })).catch(e => toast('error', 'Could not open setup terminal', errorMessage(e)))
      return
    }
    if (p || (view !== 'project' && view !== 'agents')) openProject(project.path)
    openDock('terminal')
  }
  const openAgentTerminal = () => openDock('terminal')
  const dockAgent = view === 'agents' ? terminalAgent : undefined
  const dockProject = dockAgent ? projects.find(p => p.path.toLowerCase() === dockAgent.projectPath.toLowerCase()) : selected
  const dockContext: DockContext | undefined = dockAgent
    ? { cwd: dockAgent.cwd, name: dockProject?.name ?? dockAgent.projectName, project: dockProject ?? undefined, worktree: dockAgent.worktree }
    : selected ? { cwd: selected.path, name: selected.name, project: selected } : undefined

  const resumeRecent = useCallback(
    (s: RecentSession) =>
      launch({ cwd: s.cwd || s.projectPath, projectName: s.projectName, projectPath: s.projectPath, title: s.title.slice(0, 48), kind: s.tool ?? 'claude', args: resumeArgs(s.tool ?? 'claude', s.id) }),
    [launch]
  )

  // ---------- command palette ----------
  const openPalette = useCallback(() => {
    setPaletteOpen(true)
    window.mc.recentSessions(15).then(setRecentForPalette)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      const id = combo ? shortcutIndex.current.get(combo) : undefined
      if (!id) return
      // Open dialogs handle their own keys; only the palette opens over them.
      if (document.querySelector('.overlay') && id !== 'palette') return
      if (!allowedIn(combo, e.target)) return
      e.preventDefault()
      e.stopPropagation()
      runShortcutRef.current(id)
    }
    window.addEventListener('keydown', onKey, true)
    const onRun = (e: Event) => setTimeout(() => runShortcutRef.current((e as CustomEvent<string>).detail), 0)
    window.addEventListener('mc:run-shortcut', onRun)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mc:run-shortcut', onRun)
    }
  }, [openPalette])

  /** Resumes several chats at once and shows them side by side. */
  const openMany = async (project: Project, chats: SessionSummary[]) => {
    for (const s of chats) {
      await launch({ cwd: s.cwd || project.path, projectName: project.name, projectPath: project.path, title: s.title.slice(0, 48), kind: s.tool ?? 'claude', args: resumeArgs(s.tool ?? 'claude', s.id) })
    }
    if (chats.length > 1) setLayout('grid')
    toast('success', `Opened ${chats.length} ${chats.length === 1 ? 'chat' : 'chats'} from ${project.name}`, 'Minimize, maximize or resize them from each agent’s header.')
  }

  // ---------- workspaces ----------
  const { workspaces, workspacesOpen, setWorkspacesOpen, agentCols, setAgentCols, saveWorkspace, openWorkspace, deleteWorkspace } = useWorkspaces({ agents, agentsRef, layout, setLayout, launch, toast })

  // ---------- inbox ----------
  const allInbox = inboxItems({
    now: Date.now(),
    agents,
    tasks: boardTasks,
    rateLimit,
    planAlertPercent: appSettings?.planAlertPercent ?? 80,
    budgets,
    projects,
    update,
    queue,
    restoreCount: pendingRestore?.length ?? 0
  })
  const inbox = visibleInbox(allInbox, inboxDismissed)
  const inboxBadge = inboxCount(inbox)
  const saveDismissed = (keys: string[]) => {
    // The newest few hundred are plenty: old keys never match again.
    const next = [...new Set(keys)].slice(-300)
    setInboxDismissed(next)
    window.mc.setUiState({ inboxDismissed: next })
  }
  const inboxAction = (item: InboxItem) => {
    const a = item.action
    if (a.kind === 'agent') focusAgent(a.agentId)
    else if (a.kind === 'task') {
      setView('tasks')
      setOpenTaskId(a.taskId)
    } else if (a.kind === 'view') setView(a.view)
    else if (a.kind === 'project') openProject(a.path)
    else if (a.kind === 'update') window.mc.installUpdate()
    else if (a.kind === 'restore') void restoreAll()
  }

  /** Eco mode on or off (Settings → Spending has what it changes). */
  const toggleEco = async () => {
    if (!appSettings) return
    const on = !appSettings.eco?.enabled
    await saveSettings({ eco: { ...appSettings.eco, enabled: on } })
    toast(on ? 'success' : 'info', on ? 'Eco mode on' : 'Eco mode off', on ? 'New chats and tasks use less of your plan. Running chats keep their settings until restarted.' : 'New chats and tasks use your normal settings again.')
  }

  /** New chat that starts with a skill (/name), in the open project or a quick chat. */
  const useSkill = async (skill: string) => {
    const p = selected && !selected.worktree ? selected : null
    try {
      const cwd = p?.path ?? (await window.mc.quickChatFolder())
      launch({ cwd, projectName: p?.name ?? 'Quick chat', projectPath: cwd, title: `${p?.name ?? 'Quick chat'} · /${skill}`, args: [`/${skill}`] })
    } catch (e) {
      toast('error', 'Could not start the chat', errorMessage(e))
    }
  }

  /** New session that starts by reading the project's newest briefing. */
  const startFromBriefing = async (projectPath?: string, file?: string) => {
    const p = projects.find((x) => x.path === (projectPath ?? selected?.path))
    if (!p) return
    const path = file ?? (await window.mc.latestBriefing(p.path))
    if (!path) {
      toast('info', `No briefing for ${p.name} yet`, 'One is saved automatically the next time a chat there runs out of room, or ask an agent with Write briefing.')
      return
    }
    launch({ kind: p.meta.preferredAgent ?? 'claude', cwd: p.path, projectName: p.name, projectPath: p.path, title: `${p.name} · from briefing`, args: [briefingPrompt(path)] })
  }

  /**
   * Hands a project from one agent to the other (ADR 0020): Mission Control writes a handoff from the
   * chat (the newest one by `from` when no id is given) and starts `to` reading it, in the same folder.
   */
  const handOff = useCallback(
    async (projectPath: string, from: AgentTool, to: AgentTool, sessionId?: string, worktree?: WorktreeInfo) => {
      const p = projects.find((x) => x.path === projectPath)
      const name = p?.name ?? projectPath.split(/[\\/]/).pop() ?? projectPath
      try {
        const h = await window.mc.writeHandoff(projectPath, from, to, sessionId)
        await launch({ cwd: h.cwd, projectName: name, projectPath, title: `${name} · ${TOOL_NAME[to]} (from ${TOOL_NAME[from]})`, kind: to, args: [h.prompt], worktree })
        toast('success', `${TOOL_NAME[to]} is picking up from ${TOOL_NAME[from]}`, `It starts by reading the handoff from "${h.title}", saved in ${shortPath(h.file)}.`)
      } catch (e) {
        toast('error', `Could not hand off to ${TOOL_NAME[to]}`, errorMessage(e))
      }
    },
    [projects, launch, toast]
  )

  // Codex's plan limits and token use, read from its session files (cheap: cached by file size).
  const [codexUsage, setCodexUsage] = useState<CodexUsage | null>(null)
  useEffect(() => {
    const load = () => window.mc.codexUsage(Date.now() - 30 * 86_400_000).then(setCodexUsage, () => undefined)
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  /** What each shortcut does. Anything not listed here is handled by the visible view (see useShortcutEvent). */
  const runShortcutRef = useRef<(id: string) => void>(() => undefined)
  runShortcutRef.current = (id: string) =>
    runShortcutAction(id, {
      agents,
      activeAgent,
      setActiveAgent,
      selected,
      selectedPath,
      projects,
      view,
      setView,
      showWorktrees,
      setShowWorktrees,
      setSidebarCollapsed,
      setLayout,
      appSettings,
      saveSettings,
      theme,
      notify,
      toggleNotify,
      toast,
      openProject,
      focusAgent,
      closeAgent,
      launch,
      newInSelected,
      launchWorktree,
      refreshProjects,
      addProject,
      toggleEco,
      startFromBriefing: () => startFromBriefing(),
      openPalette,
      openShortcuts: () => setShortcutsOpen(true),
      openSettings: () => setSettingsOpen(true),
      openBroadcast: () => setBroadcastOpen(true),
      openNewProject: () => setNewProjectOpen(true),
      requestNewNote: () => setNewNoteRequest(Date.now()),
      openComposer: () => setComposerOpen(true),
      openTemplates: () => setTemplatesOpen(true)
    })

  const commands = useMemo<Command[]>(
    () =>
      paletteCommands({
        setView,
        runShortcut: (id) => runShortcutRef.current(id),
        keyOf,
        toast,
        workspaces,
        openWorkspace,
        openWorkspaces: () => setWorkspacesOpen(true),
        appSettings,
        update,
        selected,
        newInSelected,
        launchWorktree,
        handOff: (path, from, to) => void handOff(path, from, to),
        launch,
        layout,
        setLayout,
        notify,
        toggleNotify,
        addProject,
        refreshProjects,
        agents,
        focusAgent,
        projects,
        showWorktrees,
        openProject,
        recentForPalette,
        resumeRecent,
        openNewProject: () => setNewProjectOpen(true),
        openComposer: () => setComposerOpen(true),
        openTemplates: () => setTemplatesOpen(true),
        openSettings: () => setSettingsOpen(true),
        openShortcuts: () => setShortcutsOpen(true)
      }),
    [workspaces, update, selected, layout, notify, agents, projects, showWorktrees, recentForPalette, newInSelected, launchWorktree, handOff, launch, toggleNotify, addProject, refreshProjects, focusAgent, openProject, resumeRecent, shortcutKeys] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <ShortcutContext.Provider value={shortcutKeys}>
    <LookContext.Provider value={lookUp}>
    <PlanRateContext.Provider value={planRate}>
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${maximizedAgent ? 'agent-maximized' : ''}`}>
      <Sidebar
        projects={projects}
        budgets={budgets}
        git={git}
        loading={loading}
        selectedPath={selectedPath}
        view={view}
        agents={agents}
        showWorktrees={showWorktrees}
        onToggleWorktrees={setShowWorktrees}
        onSelect={openProject}
        onNavigate={setView}
        onOpenPalette={openPalette}
        onRefresh={refreshProjects}
        onAdd={addProject}
        onTerminal={openProjectTerminal}
        onOpenTemplates={() => setTemplatesOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        inbox={inboxBadge}
        taskCounts={{
          running: boardTasks.filter((t) => t.column === 'running').length,
          review: boardTasks.filter((t) => t.column === 'review').length
        }}
      />
      <main className="main">
        <TopBar userName={userName} currentProject={sessionProject?.name}
          rateLimit={rateLimit}
          codexLimits={codexUsage?.limits ?? null}
          update={update}
          eco={appSettings?.eco}
          onEcoSettings={() => {
            setSettingsTab('spending')
            setSettingsOpen(true)
          }}
          onShortcut={(id) => runShortcutRef.current(id)} />
        {pendingRestore && pendingRestore.length > 0 && (
          <div className="restore-banner">
            <RotateCcw size={15} />
            <span>
              {pendingRestore.length} {pendingRestore.length === 1 ? 'agent was' : 'agents were'} open when you last closed Mission Control.
            </span>
            <Button size="sm" variant="primary" onClick={restoreAll}>
              Restore
            </Button>
            <button className="banner-close" onClick={() => setPendingRestore([])} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="view-body">
          <div className={view === 'home' ? 'view-pane' : 'view-pane hidden'}>
            <HomeView
              agents={agents}
              lastOutput={lastOutput}
              projects={projects}
              tasks={boardTasks}
              visible={view === 'home'}
              userName={userName}
              rateLimit={rateLimit}
              indexRun={indexStatus?.lastRun ?? 0}
              onOpenTask={(id) => {
                setView('tasks')
                setOpenTaskId(id)
              }}
              onTaskDone={async (id) => {
                try { await window.mc.updateTask(id, { column: 'done' }); toast('success', 'Marked done') }
                catch (e) { toast('error', 'Could not complete the task', errorMessage(e)) }
              }}
              onChat={async (tool) => {
                try {
                  const path = selected?.path ?? await window.mc.quickChatFolder()
                  const name = selected?.name ?? 'Quick chat'
                  await launch({ kind: tool, cwd: path, projectPath: path, projectName: name, title: `${name} · ${tool === 'codex' ? 'Codex' : 'Claude'}` })
                } catch (e) { toast('error', 'Could not start the chat', errorMessage(e)) }
              }}
              onRunScript={() => { if (selected) { setView('project'); openDock('run') } }}
              onTogglePin={(p) => void window.mc.togglePin(p.path).then(refreshProjects)}
              onOpenAgent={focusAgent}
              onOpenProject={openProject}
              onResume={resumeRecent}
              onNewSession={(p) => launch({ kind: p.meta.preferredAgent ?? 'claude', cwd: p.path, projectName: p.name, projectPath: p.path, title: `${p.name} · new` })}
              onShortcut={(id) => runShortcutRef.current(id)}
              currentProject={selected?.name}
            />
          </div>
          <div className={view === 'inbox' ? 'view-pane' : 'view-pane hidden'}>
            <InboxView
              visible={view === 'inbox'}
              items={showDismissed ? visibleInbox(allInbox, inboxDismissed, true) : inbox}
              hiddenCount={allInbox.length - inbox.length}
              showHidden={showDismissed}
              onToggleHidden={() => setShowDismissed((v) => !v)}
              onAction={inboxAction}
              onSecondary={(item) => {
                if (item.secondary?.action === 'taskDone' && item.action.kind === 'task') {
                  void window.mc.updateTask(item.action.taskId, { column: 'done', order: Date.now() })
                  toast('success', 'Marked done', item.title)
                }
              }}
              onDismiss={(key) => saveDismissed([...inboxDismissed, key])}
              onDismissAll={() => saveDismissed([...inboxDismissed, ...inbox.filter((i) => i.dismissable).map((i) => i.key)])}
              indexRun={indexStatus?.lastRun ?? 0}
              digestTime={appSettings?.digestTime ?? ''}
              onDigestSettings={() => {
                setSettingsTab('general')
                setSettingsOpen(true)
              }}
              onOpenProject={openProject}
              onOpenSession={openSession}
              onOpenTask={(id) => {
                setView('tasks')
                setOpenTaskId(id)
              }}
            />
          </div>
          <div className={view === 'project' ? 'view-pane' : 'view-pane hidden'}>
            {selected ? (
              <ProjectView
                key={selected.path}
                project={selected}
                projects={projects}
                git={git[selected.path]}
                visible={view === 'project'}
                groups={groups}
                focus={focusSession}
                budget={budgets[selected.path.toLowerCase().replace(/[\\/]+$/, '')]}
                onLaunch={launch}
                onOpenMany={(chats) => void openMany(selected, chats)}
                openSessions={openSessions}
                onLaunchWorktree={launchWorktree}
                onStartFromBriefing={() => void startFromBriefing(selected.path)}
                onHandOff={(from, to, sessionId) => void handOff(selected.path, from, to, sessionId)}
                onChanged={() => {
                  refreshProjects()
                }}
              />
            ) : (
              <div className="muted pad">{loading ? 'Loading projects…' : 'No projects yet. Add a folder from the sidebar.'}</div>
            )}
          </div>
          <div className={view === 'agents' ? 'view-pane' : 'view-pane hidden'}>
            <AgentsView
              agents={agents}
              activeId={activeAgent}
              layout={layout}
              maximized={maximizedAgent}
              onMaximize={setMaximizedAgent}
              cols={agentCols}
              onCols={setAgentCols}
              workspaces={workspaces}
              onOpenWorkspace={(ws) => void openWorkspace(ws)}
              onManageWorkspaces={() => setWorkspacesOpen(true)}
              onBroadcast={() => runShortcutRef.current('broadcast')}
              visible={view === 'agents'}
              lastOutput={lastOutput}
              git={git}
              contexts={contexts}
              warnAt={warnAt}
              onSelect={setActiveAgent}
              onClose={closeAgent}
              onRename={renameAgent}
              onExit={markExited}
              onLayout={setLayout}
              onNew={newInSelected}
              onTerminal={openAgentTerminal}
              onRun={() => openDock('run')}
              terminalFolder={terminalAgent?.cwd ?? selected?.path}
              onGitChanged={refreshGit}
              onHandOff={(a) => a.kind !== 'shell' && void handOff(a.projectPath, a.kind, a.kind === 'claude' ? 'codex' : 'claude', a.sessionId, a.worktree)}
            />
          </div>
          <div className={view === 'search' ? 'view-pane' : 'view-pane hidden'}>
            <OnceShown show={view === 'search'}>
              <SearchView
                visible={view === 'search'}
                projects={projects}
                status={indexStatus}
                onOpen={openSession}
                onResume={(h: SearchHit) =>
                  launch({
                    cwd: h.projectPath,
                    projectName: h.projectPath.split(/[\\/]/).pop() ?? h.projectPath,
                    projectPath: h.projectPath,
                    title: h.title.slice(0, 48),
                    kind: h.projectKey === 'codex' ? 'codex' : 'claude',
                    args: resumeArgs(h.projectKey === 'codex' ? 'codex' : 'claude', h.sessionId)
                  })
                }
              />
            </OnceShown>
          </div>
          <div className={view === 'usage' ? 'view-pane' : 'view-pane hidden'}>
            <OnceShown show={view === 'usage'}>
              <UsageView visible={view === 'usage'} status={indexStatus} rateLimit={rateLimit} onOpenProject={openProject} onOpenSession={openSession} />
            </OnceShown>
          </div>
          <div className={view === 'projects' ? 'view-pane' : 'view-pane hidden'}>
            <ProjectsView
              onChanged={refreshProjects}
              onTerminal={openProjectTerminal}
              projects={projects}
              tasks={boardTasks}
              agents={agents}
              git={git}
              showWorktrees={showWorktrees}
              onOpen={openProject}
              onNewSession={(p) => launch({ kind: p.meta.preferredAgent ?? 'claude', cwd: p.path, projectName: p.name, projectPath: p.path, title: `${p.name} · new` })}
              onNewProject={() => setNewProjectOpen(true)}
            />
          </div>
          <div className={view === 'notebook' ? 'view-pane' : 'view-pane hidden'}>
            <OnceShown show={view === 'notebook'}>
              <NotebookView projects={projects} visible={view === 'notebook'} newNoteRequest={newNoteRequest} onOpenProject={openProject} onProjectNotesSaved={() => void refreshProjects()} />
            </OnceShown>
          </div>
          <div className={view === 'skills' ? 'view-pane' : 'view-pane hidden'}>
            <OnceShown show={view === 'skills'}>
              <SkillsView
                visible={view === 'skills'}
                eco={appSettings?.eco}
                projects={projects}
                projectName={selected && !selected.worktree ? selected.name : undefined}
                onUse={(id) => void useSkill(id)}
                onToggleEco={() => void toggleEco()}
                onEcoSettings={() => {
                  setSettingsTab('spending')
                  setSettingsOpen(true)
                }}
              />
            </OnceShown>
          </div>
          <div className={view === 'knowledge' ? 'view-pane' : 'view-pane hidden'}>
            <OnceShown show={view === 'knowledge'}>
              <KnowledgeView visible={view === 'knowledge'} onStartFromBriefing={(projectPath, file) => void startFromBriefing(projectPath, file)} />
            </OnceShown>
          </div>
          <div className={view === 'tasks' ? 'view-pane' : 'view-pane hidden'}>
            <TasksView
              tasks={tasks}
              agents={agents}
              projects={projects}
              queue={queue}
              onQueueSettings={async (patch) => {
                await window.mc.setSettings(patch)
                setQueue(await window.mc.queueStatus())
              }}
              onToggleQueued={(t) => window.mc.updateTask(t.id, { queued: !t.queued })}
              onOpenTemplates={() => setTemplatesOpen(true)}
              projectFilter={taskFilter}
              onProjectFilter={setTaskFilter}
              onNew={() => setComposerOpen(true)}
              onOpen={(t) => setOpenTaskId(t.id)}
              onStart={startTask}
              onStop={(t) => window.mc.stopTask(t.id)}
              onMove={(t, column) => window.mc.updateTask(t.id, { column, order: Date.now() })}
              onOpenAgent={focusAgent}
              visible={view === 'tasks'}
              layout={tasksLayout}
              onLayout={(l) => {
                setTasksLayout(l)
                setTerminalFocus(null)
              }}
              onShowTerminal={showTaskTerminal}
              terminalFocus={terminalFocus}
            />
          </div>
        </div>
        <BottomDock context={dockContext} request={dockRequest} visible={view === 'project' || view === 'agents'} onChanged={refreshProjects} onLaunch={launch} />
        {openTask && view === 'tasks' && (
          <TaskDrawer
            task={openTask}
            all={tasks}
            onOpenTask={(t) => setOpenTaskId(t.id)}
            onAddAfter={(t) => {
              setComposerInitial({ projectPath: t.projectPath, dependsOn: [t.id], mode: t.mode, permission: t.permission, useWorktree: t.useWorktree, model: t.model })
              setComposerOpen(true)
            }}
            agent={openTask.run?.agentId ? agents.find((a) => a.id === openTask.run!.agentId) : undefined}
            onClose={() => setOpenTaskId(null)}
            onStart={startTask}
            onStop={(t) => window.mc.stopTask(t.id)}
            onContinue={continueTask}
            onOpenAgent={focusAgent}
            onDone={(t) => window.mc.updateTask(t.id, { column: 'done', order: Date.now() })}
            onDelete={async (t) => {
              if (window.confirm(`Delete the task "${t.title}"?`)) {
                try { await window.mc.deleteTask(t.id); setOpenTaskId(null) }
                catch (e) { toast('error', 'Could not delete the task', errorMessage(e)) }
              }
            }}
            onGitChanged={refreshGit}
          />
        )}
        <StatusBar
          indexStatus={indexStatus}
          update={update}
          view={view}
          project={selected}
          git={selected ? git[selected.path] : undefined}
          agents={agents}
          notify={notify}
          onToggleNotify={toggleNotify}
          onShowAttention={() => {
            const a = agents.find((x) => !x.exited && x.hookStatus === 'needs-input')
            if (a) focusAgent(a.id)
          }}
        />
      </main>
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {broadcastOpen && <BroadcastDialog agents={agents.filter((a) => a.kind !== 'shell' && !a.exited)} lastOutput={lastOutput} onClose={() => setBroadcastOpen(false)} />}
      {workspacesOpen && (
        <WorkspacesDialog
          workspaces={workspaces}
          agents={agents.filter((a) => !a.exited)}
          layout={layout}
          onSave={(name, id) => void saveWorkspace(name, id)}
          onOpen={(ws) => void openWorkspace(ws)}
          onDelete={deleteWorkspace}
          onClose={() => setWorkspacesOpen(false)}
        />
      )}
      {composerOpen && (
        <TaskComposer
          tasks={boardTasks}
          projects={projects}
          git={git}
          defaultProject={taskFilter || selectedPath || undefined}
          initial={composerInitial}
          onCancel={() => {
            setComposerOpen(false)
            setComposerInitial(undefined)
          }}
          onCreate={async (input, then) => {
            setComposerOpen(false)
            setComposerInitial(undefined)
            setView('tasks')
            const task = await window.mc.createTask({ ...input, queued: then === 'queue' })
            if (then === 'start') startTask(task)
            if (then === 'team') {
              setOpenTaskId(task.id)
              try { await window.mc.planTaskTeam(task.id) }
              catch (e) { toast('error', 'Could not split the task into agents', errorMessage(e)) }
            }
            if (then === 'queue') toast('info', 'Added to the queue', queue?.enabled ? task.title : 'Turn on “Auto-run queue” to start it automatically.')
          }}
          onSaveTemplate={saveAsTemplate}
        />
      )}
      {templatesOpen && (
        <Suspense fallback={null}>
          <TemplatesDialog
            templates={templates}
            projects={projects}
            onClose={() => setTemplatesOpen(false)}
            onUse={(tpl) => {
              setTemplatesOpen(false)
              setComposerInitial({
                title: tpl.title,
                prompt: tpl.prompt,
                projectPath: tpl.projectPath,
                mode: tpl.mode,
                permission: tpl.permission,
                useWorktree: tpl.useWorktree,
                budgetUsd: tpl.budgetUsd,
                model: tpl.model,
                templateId: tpl.id
              })
              setComposerOpen(true)
            }}
          />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            initialTab={settingsTab}
            onClose={() => {
              setSettingsOpen(false)
              setSettingsTab(undefined)
            }}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        </Suspense>
      )}
      {newProjectOpen && (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onAddExisting={() => {
            setNewProjectOpen(false)
            void addProject()
          }}
          onCreated={async (path) => {
            setNewProjectOpen(false)
            await refreshProjects()
            openProject(path)
            toast('success', 'Project created', path)
          }}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog overrides={appSettings?.keybindings ?? {}} onChange={(keybindings) => void saveSettings({ keybindings })} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
    </PlanRateContext.Provider>
    </LookContext.Provider>
    </ShortcutContext.Provider>
  )
}
