import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Bell,
  Bot,
  FileStack,
  KanbanSquare,
  ListPlus,
  Settings,
  TextSearch,
  FolderOpen,
  FolderPlus,
  GitFork,
  History,
  House,
  LayoutGrid,
  Play,
  RefreshCw,
  RotateCcw,
  Rows2,
  Terminal,
  X,
  Keyboard,
  BookOpen,
  MessageSquareDashed,
  NotebookPen,
  PanelLeft,
  SunMoon,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type {
  GitInfo,
  IndexStatus,
  NewTask,
  Project,
  QueueStatus,
  RateLimitInfo,
  RecentSession,
  SavedAgent,
  SearchHit,
  Task,
  TaskTemplate,
  UpdateState,
  AppSettings,
  BudgetState,
  ContextUsage
} from '@shared/types'
import TemplatesDialog from './components/TemplatesDialog'
import TasksView from './components/TasksView'
import TaskComposer from './components/TaskComposer'
import TaskDrawer from './components/TaskDrawer'
import SettingsDialog from './components/SettingsDialog'
import SearchView from './components/SearchView'
import UsageView from './components/UsageView'
import Sidebar from './components/Sidebar'
import HomeView from './components/HomeView'
import ProjectView from './components/ProjectView'
import AgentsView from './components/AgentsView'
import StatusBar from './components/StatusBar'
import CommandPalette, { type Command } from './components/CommandPalette'
import { Button } from './components/ui'
import type { Agent, AgentLayout, LaunchOptions, View } from './types'
import { onActivity } from './terminalBus'
import { statusFromHook } from './agentStatus'
import { useToast } from './toast'
import { errorMessage } from './util'
import { LookContext, makeLookUp } from './projectLook'
import { ShortcutContext, allowedIn, bindingIndex, comboFromEvent, effectiveKeys } from './shortcuts'
import ShortcutsDialog from './components/ShortcutsDialog'
import TopBar from './components/TopBar'
import ProjectsView from './components/ProjectsView'
import NotebookView from './components/NotebookView'
import KnowledgeView from './components/KnowledgeView'
import NewProjectDialog from './components/NewProjectDialog'
import { sidebarOrder } from './components/Sidebar'
import { worktreeParent } from '@shared/projectLook'

function loadNotifyPref(): boolean {
  try {
    return localStorage.getItem('mc.notify') !== 'off'
  } catch {
    return true
  }
}

export default function App() {
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const lookUp = useMemo(() => makeLookUp(projects), [projects])
  const [git, setGit] = useState<Record<string, GitInfo>>({})
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('home')
  const [agents, setAgents] = useState<Agent[]>([])
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [layout, setLayout] = useState<AgentLayout>('tabs')
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [lastOutput, setLastOutput] = useState<Record<string, number>>({})
  const [notify, setNotify] = useState(loadNotifyPref)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [recentForPalette, setRecentForPalette] = useState<RecentSession[]>([])
  /** Agents from the last run that haven't been restored or dismissed yet; null until loaded. */
  const [pendingRestore, setPendingRestore] = useState<SavedAgent[] | null>(null)
  const [uiLoaded, setUiLoaded] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [taskFilter, setTaskFilter] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [composerInitial, setComposerInitial] = useState<Partial<NewTask> | undefined>()
  const [queue, setQueue] = useState<QueueStatus | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' })
  const [budgets, setBudgets] = useState<Record<string, BudgetState>>({})

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
    window.mc.listTasks().then(setTasks)
    window.mc.getRateLimit().then(setRateLimit)
    const offTasks = window.mc.onTasksChanged(setTasks)
    const offRate = window.mc.onRateLimit(setRateLimit)
    // The tray menu and notifications can send the UI somewhere.
    const offNav = window.mc.onNavigate((target) => {
      setView(target.view as View)
      if (target.newTask) setComposerOpen(true)
      if (target.chat) openSessionRef.current(target.chat.projectPath, target.chat.sessionId)
      if (target.taskId) setOpenTaskId(target.taskId)
    })
    return () => {
      offTasks()
      offRate()
      offNav()
    }
  }, [])
  const [focusSession, setFocusSession] = useState<{ sessionId: string; nonce: number } | undefined>()

  useEffect(() => {
    window.mc.indexStatus().then(setIndexStatus)
    return window.mc.onIndexStatus(setIndexStatus)
  }, [])
  const [, setTick] = useState(0)

  // Hook events and timers run outside React's render cycle; refs give them current values.
  const agentsRef = useRef(agents)
  // How big each live chat is (by session id), refreshed every few seconds.
  const [contexts, setContexts] = useState<Record<string, ContextUsage>>({})
  const warnedContext = useRef(new Set<string>())
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const warnAt = appSettings?.contextWarnTokens ?? 200_000
  const reloadSettings = useCallback(() => window.mc.getSettings().then(setAppSettings).catch(() => undefined), [])
  useEffect(() => {
    void reloadSettings()
  }, [settingsOpen, reloadSettings])
  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      setAppSettings((cur) => (cur ? { ...cur, ...patch } : cur))
      await window.mc.setSettings(patch)
      await reloadSettings()
    },
    [reloadSettings]
  )

  // Theme: "system" follows Windows' light/dark setting.
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const theme = appSettings?.theme === 'system' ? (systemDark ? 'dark' : 'light') : (appSettings?.theme ?? 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    if (appSettings) window.mc.setZoom(appSettings.uiZoom || 1)
  }, [appSettings?.uiZoom]) // eslint-disable-line react-hooks/exhaustive-deps

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
  useEffect(() => {
    const tick = async () => {
      const live = agentsRef.current.filter((a) => a.kind === 'claude' && !a.exited && a.sessionId)
      if (!live.length) return setContexts((c) => (Object.keys(c).length ? {} : c))
      const next = await window.mc.contextUsage(live.map((a) => a.sessionId!)).catch(() => null)
      if (!next) return
      setContexts(next)
      for (const a of live) {
        const u = next[a.sessionId!]
        if (!u || u.tokens < warnAt || warnedContext.current.has(a.sessionId!)) continue
        warnedContext.current.add(a.sessionId!)
        toast('info', `${a.title} is getting large`, `${Math.round(u.tokens / 1000)}K tokens: each reply re-reads all of it (about $${u.perTurnUsd.toFixed(2)}). Press Compact on the agent to shrink it.`)
      }
    }
    void tick()
    const timer = setInterval(tick, 8000)
    return () => clearInterval(timer)
  }, [warnAt, toast])
  agentsRef.current = agents
  const uiRef = useRef({ view, activeAgent, notify })
  uiRef.current = { view, activeAgent, notify }
  const projectsRef = useRef(projects)
  projectsRef.current = projects

  // ---------- data ----------
  const refreshGit = useCallback(async () => {
    const paths = new Set<string>()
    for (const p of projectsRef.current) if (!p.worktree || showWorktrees) paths.add(p.path)
    for (const a of agentsRef.current) paths.add(a.projectPath)
    if (paths.size === 0) return
    const info = await window.mc.gitInfoMany([...paths])
    setGit((prev) => ({ ...prev, ...info }))
  }, [showWorktrees])

  const refreshProjects = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.mc.listProjects()
      setProjects(list)
      projectsRef.current = list
      setSelectedPath((cur) => (cur && list.some((p) => p.path === cur) ? cur : (list.find((p) => !p.worktree)?.path ?? null)))
      refreshGit()
    } finally {
      setLoading(false)
    }
  }, [refreshGit])

  useEffect(() => {
    window.mc.getUiState().then((ui) => {
      if (ui.selectedPath) setSelectedPath(ui.selectedPath)
      if (ui.view) setView(ui.view)
      if (ui.layout) setLayout(ui.layout)
      if (ui.showWorktrees) setShowWorktrees(true)
      if (ui.sidebarCollapsed) setSidebarCollapsed(true)
      setUiLoaded(true)
      refreshProjects()
    })
    window.mc.loadSavedAgents().then(setPendingRestore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (uiLoaded) window.mc.setUiState({ selectedPath: selectedPath ?? undefined, view, layout, showWorktrees, sidebarCollapsed })
  }, [uiLoaded, selectedPath, view, layout, showWorktrees, sidebarCollapsed])

  // Keep git badges fresh: on an interval and whenever the window regains focus.
  useEffect(() => {
    const timer = setInterval(refreshGit, 15000)
    window.addEventListener('focus', refreshGit)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refreshGit)
    }
  }, [refreshGit])

  // Track when each terminal last printed output, for agents without hook status.
  useEffect(() => {
    let pendingUpdate: Record<string, number> = {}
    let scheduled = false
    const off = onActivity((id) => {
      pendingUpdate[id] = Date.now()
      if (scheduled) return
      scheduled = true
      setTimeout(() => {
        const batch = pendingUpdate
        pendingUpdate = {}
        scheduled = false
        setLastOutput((prev) => ({ ...prev, ...batch }))
      }, 250)
    })
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  const focusAgent = useCallback((id: string) => {
    window.mc.focusWindow()
    setView('agents')
    setActiveAgent(id)
  }, [])

  // Exact status from Claude Code hooks, plus desktop notifications.
  useEffect(() => {
    return window.mc.onHookEvent((event) => {
      const agent = agentsRef.current.find((a) => a.id === event.agentId)
      if (!agent || agent.exited) return
      const change = statusFromHook(event, agent.hookStatus)
      setAgents((list) =>
        list.map((a) =>
          a.id !== event.agentId
            ? a
            : {
                ...a,
                sessionId: event.sessionId ?? a.sessionId,
                hookStatus: change?.status ?? a.hookStatus,
                statusMessage: change ? change.message : a.statusMessage
              }
        )
      )
      // A finished turn usually means files changed.
      if (event.event === 'Stop') refreshGit()
      const ui = uiRef.current
      const lookingAtIt = document.hasFocus() && ui.view === 'agents' && ui.activeAgent === agent.id
      if (change?.notify && ui.notify && !lookingAtIt) {
        const body = change.status === 'done' ? 'Finished. Your turn.' : change.message || 'Claude needs your input.'
        const n = new Notification(agent.title, { body, silent: false })
        n.onclick = () => focusAgent(agent.id)
      }
    })
  }, [focusAgent, refreshGit])

  // Remember open agents so they can be reopened after a restart.
  useEffect(() => {
    if (pendingRestore === null) return
    const open: SavedAgent[] = agents
      .filter((a) => !a.exited)
      .map(({ title, cwd, projectName, projectPath, kind, sessionId, worktree }) => ({ title, cwd, projectName, projectPath, kind, sessionId, worktree }))
    window.mc.saveAgents([...pendingRestore, ...open])
  }, [agents, pendingRestore])

  // ---------- actions ----------
  const launch = useCallback(
    async (opts: LaunchOptions) => {
      const kind = opts.kind ?? 'claude'
      try {
        const info = await window.mc.ptySpawn({ cwd: opts.cwd, args: opts.args ?? [], kind, cols: 120, rows: 30 })
        const agent: Agent = {
          id: info.id,
          title: opts.title,
          cwd: opts.cwd,
          projectName: opts.projectName,
          projectPath: opts.projectPath ?? opts.cwd,
          kind,
          sessionId: info.sessionId,
          worktree: opts.worktree,
          exited: false,
          startedAt: Date.now()
        }
        setAgents((a) => [...a, agent])
        setActiveAgent(info.id)
        setView('agents')
        return info
      } catch (e) {
        toast('error', 'Could not start the agent', errorMessage(e))
        return null
      }
    },
    [toast]
  )

  // ---------- tasks ----------
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const startTask = useCallback(
    async (task: Task) => {
      try {
        const res = await window.mc.startTask(task.id)
        if (res.interactive) {
          const { cwd, args, worktree } = res.interactive
          const info = await launch({ cwd, projectName: task.projectName, projectPath: task.projectPath, title: task.title.slice(0, 48), args, worktree })
          if (info) {
            await window.mc.setTaskRun(
              task.id,
              { agentId: info.id, sessionId: info.sessionId, startedAt: Date.now(), finishedAt: undefined, error: undefined, result: undefined, toolCalls: 0, events: [], activity: 'Running in an agent tab' },
              'running'
            )
          }
        } else {
          toast('info', 'Task started', task.title)
        }
      } catch (e) {
        toast('error', 'Could not start the task', errorMessage(e))
      }
    },
    [launch, toast]
  )

  // A recurring interactive task fired: open its agent.
  useEffect(() => {
    return window.mc.onLaunchTask(async (taskId) => {
      const task = (await window.mc.listTasks()).find((t) => t.id === taskId)
      if (task) startTask(task)
    })
  }, [startTask])

  const saveAsTemplate = useCallback(
    async (input: NewTask) => {
      try {
        const name = input.title || input.prompt.split('\n')[0].slice(0, 60)
        await window.mc.saveTemplate({
          name,
          title: input.title,
          prompt: input.prompt,
          projectPath: input.projectPath,
          projectName: input.projectName,
          mode: input.mode,
          permission: input.permission,
          useWorktree: input.useWorktree,
          budgetUsd: input.budgetUsd,
          model: input.model
        })
        toast('success', 'Saved as a template', `${name}. Add a schedule in Templates.`)
      } catch (e) {
        toast('error', 'Could not save the template', errorMessage(e))
      }
    },
    [toast]
  )

  const continueTask = useCallback(
    (task: Task) => {
      if (!task.run?.sessionId) return
      launch({
        cwd: task.worktree?.path ?? task.projectPath,
        projectName: task.projectName,
        projectPath: task.projectPath,
        title: task.title.slice(0, 48),
        args: ['--resume', task.run.sessionId],
        worktree: task.worktree
      })
    },
    [launch]
  )

  // An interactive task's agent closing ends its run; move it to Review.
  useEffect(() => {
    for (const t of tasksRef.current) {
      const agentId = t.run?.agentId
      if (t.column !== 'running' || !agentId) continue
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.exited) {
        window.mc.setTaskRun(t.id, { agentId: undefined, finishedAt: Date.now(), activity: 'Agent closed' }, 'review')
      }
    }
  }, [agents])

  // Live counts for the tray tooltip.
  useEffect(() => {
    const live = agents.filter((a) => !a.exited)
    window.mc.reportStatus({ agents: live.length, attention: live.filter((a) => a.hookStatus === 'needs-input').length })
  }, [agents])

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
          worktree: wt
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
    ;(window as any).__mcSmoke = { launch, agents: () => agentsRef.current, setView, openPalette: () => setPaletteOpen(true), selectProject: setSelectedPath, refresh: refreshProjects, openComposer: () => setComposerOpen(true), openTask: setOpenTaskId, openTemplates: () => setTemplatesOpen(true), openSettings: () => setSettingsOpen(true), openShortcuts: () => setShortcutsOpen(true), runShortcut: (id: string) => runShortcutRef.current(id), startTask, tasks: () => tasksRef.current }
  }, [launch, refreshProjects, startTask])

  const restoreAll = useCallback(async () => {
    const saved = pendingRestore ?? []
    setPendingRestore([])
    for (const s of saved) {
      // A session that never got a prompt has no transcript, so it can't be resumed; start fresh.
      const canResume = s.kind === 'claude' && s.sessionId && (await window.mc.sessionExists(s.sessionId))
      await launch({
        cwd: s.cwd,
        projectName: s.projectName,
        projectPath: s.projectPath,
        title: s.title,
        kind: s.kind,
        worktree: s.worktree,
        args: canResume ? ['--resume', s.sessionId!] : []
      })
    }
  }, [pendingRestore, launch])

  const closeAgent = useCallback((id: string) => {
    window.mc.ptyKill(id)
    setAgents((list) => {
      const next = list.filter((a) => a.id !== id)
      setActiveAgent((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur))
      return next
    })
  }, [])

  const renameAgent = useCallback((id: string, title: string) => {
    setAgents((list) => list.map((a) => (a.id === id ? { ...a, title } : a)))
  }, [])

  const markExited = useCallback((id: string, code: number) => {
    setAgents((list) => list.map((a) => (a.id === id ? { ...a, exited: true, exitCode: code } : a)))
  }, [])

  const toggleNotify = useCallback(() => {
    setNotify((cur) => {
      const next = !cur
      try {
        localStorage.setItem('mc.notify', next ? 'on' : 'off')
      } catch {
        /* preference just won't persist */
      }
      return next
    })
  }, [])

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
    (projectPath: string, sessionId: string) => {
      openProject(projectPath)
      setFocusSession({ sessionId, nonce: Date.now() })
    },
    [openProject]
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
  // The index knows which project a chat started from C:\ worked in, so re-list projects when it updates.
  useEffect(() => {
    if (indexStatus?.lastRun) void refreshProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexStatus?.lastRun])

  const selected = projects.find((p) => p.path === selectedPath) ?? null
  const openTask = tasks.find((t) => t.id === openTaskId) ?? null
  const newInSelected = useCallback(() => {
    if (selected) launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · new` })
  }, [selected, launch])

  const resumeRecent = useCallback(
    (s: RecentSession) =>
      launch({ cwd: s.cwd || s.projectPath, projectName: s.projectName, projectPath: s.projectPath, title: s.title.slice(0, 48), args: ['--resume', s.id] }),
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
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openPalette])

  /** What each shortcut does. Anything not listed here is handled by the visible view (see useShortcutEvent). */
  const runShortcutRef = useRef<(id: string) => void>(() => undefined)
  runShortcutRef.current = (id: string) => {
    const active = agents.find((a) => a.id === activeAgent) ?? agents[agents.length - 1]
    const broadcast = (shortcut: string) => window.dispatchEvent(new CustomEvent('mc:shortcut', { detail: shortcut }))
    const inProject = (shortcut: string) => {
      if (!selected) return
      if (view !== 'project') {
        setView('project')
        setTimeout(() => broadcast(shortcut), 50)
      } else broadcast(shortcut)
    }
    const cycleProject = (step: number) => {
      const order = sidebarOrder(projects, showWorktrees)
      if (!order.length) return
      const i = order.findIndex((p) => p.path === selectedPath)
      openProject(order[(i + step + order.length) % order.length].path)
    }
    const cycleAgent = (step: number) => {
      if (!agents.length) return
      const i = agents.findIndex((a) => a.id === active?.id)
      focusAgent(agents[(i + step + agents.length) % agents.length].id)
    }
    const zoom = (factor: number) => void saveSettings({ uiZoom: Math.round(Math.min(1.6, Math.max(0.7, factor)) * 10) / 10 })
    const handlers: Record<string, () => void> = {
      palette: openPalette,
      shortcuts: () => setShortcutsOpen(true),
      settings: () => setSettingsOpen(true),
      refresh: () => void refreshProjects(),
      addProject: () => void addProject(),
      notifications: () => {
        toggleNotify()
        toast('info', notify ? 'Notifications off' : 'Notifications on')
      },
      goHome: () => setView('home'),
      goAgents: () => setView('agents'),
      goTasks: () => setView('tasks'),
      goSearch: () => setView('search'),
      goUsage: () => setView('usage'),
      goProject: () => selected && setView('project'),
      goProjects: () => setView('projects'),
      goNotebook: () => setView('notebook'),
      goKnowledge: () => setView('knowledge'),
      newProject: () => setNewProjectOpen(true),
      newNote: () => {
        setView('notebook')
        setNewNoteRequest(Date.now())
      },
      quickChat: () =>
        void window.mc
          .quickChatFolder()
          .then((folder) => launch({ cwd: folder, projectName: 'Quick chat', projectPath: folder, title: 'Quick chat' }))
          .catch((e) => toast('error', 'Could not start a quick chat', errorMessage(e))),
      prevProject: () => cycleProject(-1),
      nextProject: () => cycleProject(1),
      newSession: () => selected && newInSelected(),
      newWorktreeSession: () => selected && launchWorktree(selected),
      continueLast: () =>
        selected && launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · continued`, args: ['--continue'] }),
      powershell: () => selected && launch({ cwd: selected.path, projectName: selected.name, projectPath: selected.path, title: `${selected.name} · shell`, kind: 'shell' }),
      pinProject: () => {
        if (!selected) return
        void window.mc.togglePin(selected.path).then(refreshProjects)
        toast('info', selected.pinned ? `Unpinned ${selected.name}` : `Pinned ${selected.name}`)
      },
      openExplorer: () => selected && window.mc.openInExplorer(selected.path),
      openVSCode: () => selected && window.mc.openInVSCode(selected.path),
      openTerminal: () => selected && window.mc.openExternalTerminal(selected.path, []),
      nextAgent: () => cycleAgent(1),
      prevAgent: () => cycleAgent(-1),
      closeAgent: () => active && closeAgent(active.id),
      toggleGrid: () => setLayout((l) => (l === 'tabs' ? 'grid' : 'tabs')),
      compactAgent: () => {
        if (!active || active.kind !== 'claude' || active.exited) return
        window.mc.ptyWrite(active.id, '/compact\r')
        toast('info', `Compacting ${active.title}`, 'Claude summarizes the chat so far and continues from the summary.')
      },
      toggleReview: () => {
        setView('agents')
        setTimeout(() => broadcast('toggleReview'), 50)
      },
      renameAgent: () => {
        setView('agents')
        setTimeout(() => broadcast('renameAgent'), 50)
      },
      newTask: () => setComposerOpen(true),
      templates: () => setTemplatesOpen(true),
      toggleQueue: () => {
        const on = !appSettings?.queueEnabled
        void saveSettings({ queueEnabled: on })
        toast('info', on ? 'Auto-run queue on' : 'Auto-run queue off')
      },
      toggleSidebar: () => setSidebarCollapsed((c) => !c),
      toggleTheme: () => void saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' }),
      zoomIn: () => zoom((appSettings?.uiZoom ?? 1) + 0.1),
      zoomOut: () => zoom((appSettings?.uiZoom ?? 1) - 0.1),
      zoomReset: () => zoom(1),
      toggleWorktrees: () => setShowWorktrees((v) => !v)
    }
    for (let n = 1; n <= 9; n++) handlers[`agent${n}`] = () => agents[n - 1] && focusAgent(agents[n - 1].id)
    for (const t of ['tabOverview', 'tabChats', 'tabChanges', 'tabDocs', 'nameIcon', 'chatFilter', 'chatNext', 'chatPrev', 'chatResume', 'chatRename']) handlers[t] = () => inProject(t)
    ;(handlers[id] ?? (() => broadcast(id)))()
  }

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'go-home', group: 'Go to', title: 'Home', icon: House, run: () => setView('home') },
      { id: 'go-agents', group: 'Go to', title: 'Agents', icon: Bot, run: () => setView('agents') },
      { id: 'go-search', group: 'Go to', title: 'Search all chats', hint: 'Ctrl+Shift+F', icon: TextSearch, keywords: 'find full text', run: () => setView('search') },
      { id: 'go-usage', group: 'Go to', title: 'Usage and cost', icon: BarChart3, keywords: 'tokens stats spend', run: () => setView('usage') },
      { id: 'go-tasks', group: 'Go to', title: 'Task board', icon: KanbanSquare, keywords: 'kanban todo', run: () => setView('tasks') },
      { id: 'go-projects', group: 'Go to', title: 'All projects', icon: FolderOpen, keywords: 'cards folders', run: () => setView('projects') },
      { id: 'go-notebook', group: 'Go to', title: 'Notebook', icon: NotebookPen, keywords: 'notes write', run: () => setView('notebook') },
      { id: 'go-knowledge', group: 'Go to', title: 'Knowledge (all docs)', icon: BookOpen, keywords: 'docs readme claude.md', run: () => setView('knowledge') },
      { id: 'new-project', group: 'Actions', title: 'New project…', icon: FolderPlus, keywords: 'create folder', run: () => setNewProjectOpen(true) },
      { id: 'quick-chat', group: 'Actions', title: 'Quick chat', icon: MessageSquareDashed, keywords: 'temporary scratch', run: () => runShortcutRef.current('quickChat') },
      { id: 'new-note', group: 'Actions', title: 'New note', icon: NotebookPen, keywords: 'notebook write', run: () => runShortcutRef.current('newNote') },
      { id: 'new-task', group: 'Actions', title: 'New task…', icon: ListPlus, keywords: 'kanban headless background', run: () => setComposerOpen(true) },
      { id: 'templates', group: 'Actions', title: 'Task templates and schedules', icon: FileStack, keywords: 'recurring cron repeat', run: () => setTemplatesOpen(true) },
      { id: 'settings', group: 'Actions', title: 'Settings', icon: Settings, keywords: 'hotkey shortcut tray', run: () => setSettingsOpen(true) },
      { id: 'shortcuts', group: 'Actions', title: 'Keyboard shortcuts', icon: Keyboard, keywords: 'keys hotkeys bindings', run: () => setShortcutsOpen(true) },
      { id: 'toggleSidebar', group: 'View', title: 'Show or hide sidebar', icon: PanelLeft, run: () => runShortcutRef.current('toggleSidebar') },
      { id: 'toggleTheme', group: 'View', title: 'Light or dark theme', icon: SunMoon, keywords: 'appearance colors', run: () => runShortcutRef.current('toggleTheme') },
      { id: 'zoomIn', group: 'View', title: 'Zoom in', icon: ZoomIn, keywords: 'bigger text size', run: () => runShortcutRef.current('zoomIn') },
      { id: 'zoomOut', group: 'View', title: 'Zoom out', icon: ZoomOut, keywords: 'smaller text size', run: () => runShortcutRef.current('zoomOut') },
      { id: 'zoomReset', group: 'View', title: 'Reset zoom', icon: ZoomIn, run: () => runShortcutRef.current('zoomReset') }
    ]
    if (selected) {
      list.push(
        { id: 'new', group: 'Actions', title: `New Claude session in ${selected.name}`, icon: Play, run: newInSelected },
        { id: 'new-wt', group: 'Actions', title: `New session in a worktree of ${selected.name}`, icon: GitFork, keywords: 'branch parallel', run: () => launchWorktree(selected) },
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
      { id: 'layout', group: 'Actions', title: layout === 'tabs' ? 'Show agents in a grid' : 'Show agents as tabs', icon: layout === 'tabs' ? LayoutGrid : Rows2, run: () => setLayout(layout === 'tabs' ? 'grid' : 'tabs') },
      { id: 'notify', group: 'Actions', title: notify ? 'Turn notifications off' : 'Turn notifications on', icon: Bell, run: toggleNotify },
      { id: 'add', group: 'Actions', title: 'Add a project folder…', icon: FolderPlus, run: addProject },
      { id: 'refresh', group: 'Actions', title: 'Refresh projects', icon: RefreshCw, run: refreshProjects }
    )
    for (const a of agents.filter((x) => !x.exited)) {
      list.push({ id: `agent-${a.id}`, group: 'Agents', title: a.title, hint: a.projectName, icon: Bot, run: () => focusAgent(a.id) })
    }
    for (const p of projects.filter((x) => showWorktrees || !x.worktree)) {
      list.push({ id: `proj-${p.path}`, group: 'Projects', title: p.name, hint: p.path, icon: FolderOpen, keywords: p.path, run: () => openProject(p.path) })
    }
    // Show each command's shortcut.
    const shortcutOf: Record<string, string> = {
      'go-home': 'goHome', 'go-projects': 'goProjects', 'go-notebook': 'goNotebook', 'go-knowledge': 'goKnowledge',
      'new-project': 'newProject', 'quick-chat': 'quickChat', 'new-note': 'newNote', 'go-agents': 'goAgents', 'go-search': 'goSearch', 'go-usage': 'goUsage', 'go-tasks': 'goTasks',
      'new-task': 'newTask', templates: 'templates', settings: 'settings', shortcuts: 'shortcuts', new: 'newSession',
      'new-wt': 'newWorktreeSession', continue: 'continueLast', shell: 'powershell', layout: 'toggleGrid', notify: 'notifications',
      add: 'addProject', refresh: 'refresh', toggleSidebar: 'toggleSidebar', toggleTheme: 'toggleTheme', zoomIn: 'zoomIn',
      zoomOut: 'zoomOut', zoomReset: 'zoomReset'
    }
    for (const c of list) if (shortcutOf[c.id]) c.hint = keyOf(shortcutOf[c.id]) || c.hint
    for (const s of recentForPalette) {
      list.push({ id: `chat-${s.id}`, group: 'Resume a chat', title: s.title, hint: s.projectName, icon: History, keywords: s.projectName, run: () => resumeRecent(s) })
    }
    return list
  }, [selected, layout, notify, agents, projects, showWorktrees, recentForPalette, newInSelected, launchWorktree, launch, toggleNotify, addProject, refreshProjects, focusAgent, openProject, resumeRecent, shortcutKeys]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ShortcutContext.Provider value={shortcutKeys}>
    <LookContext.Provider value={lookUp}>
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
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
        onOpenTemplates={() => setTemplatesOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        taskCounts={{
          running: tasks.filter((t) => t.column === 'running').length,
          review: tasks.filter((t) => t.column === 'review').length
        }}
      />
      <main className="main">
        <TopBar theme={theme} userName={userName} currentProject={selected?.name} onShortcut={(id) => runShortcutRef.current(id)} />
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
              tasks={tasks}
              visible={view === 'home'}
              userName={userName}
              rateLimit={rateLimit}
              indexRun={indexStatus?.lastRun ?? 0}
              onOpenTask={(id) => {
                setView('tasks')
                setOpenTaskId(id)
              }}
              onTaskDone={(id) => {
                void window.mc.updateTask(id, { column: 'done' })
                toast('success', 'Marked done')
              }}
              onTogglePin={(p) => void window.mc.togglePin(p.path).then(refreshProjects)}
              onOpenAgent={focusAgent}
              onOpenProject={openProject}
              onResume={resumeRecent}
              onNewSession={(p) => launch({ cwd: p.path, projectName: p.name, projectPath: p.path, title: `${p.name} · new` })}
              onShortcut={(id) => runShortcutRef.current(id)}
              currentProject={selected?.name}
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
                onLaunchWorktree={launchWorktree}
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
              onGitChanged={refreshGit}
            />
          </div>
          <div className={view === 'search' ? 'view-pane' : 'view-pane hidden'}>
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
                  args: ['--resume', h.sessionId]
                })
              }
            />
          </div>
          <div className={view === 'usage' ? 'view-pane' : 'view-pane hidden'}>
            <UsageView visible={view === 'usage'} status={indexStatus} rateLimit={rateLimit} onOpenProject={openProject} onOpenSession={openSession} />
          </div>
          <div className={view === 'projects' ? 'view-pane' : 'view-pane hidden'}>
            <ProjectsView
              projects={projects}
              tasks={tasks}
              agents={agents}
              git={git}
              showWorktrees={showWorktrees}
              onOpen={openProject}
              onNewSession={(p) => launch({ cwd: p.path, projectName: p.name, projectPath: p.path, title: `${p.name} · new` })}
              onNewProject={() => setNewProjectOpen(true)}
            />
          </div>
          <div className={view === 'notebook' ? 'view-pane' : 'view-pane hidden'}>
            <NotebookView projects={projects} visible={view === 'notebook'} newNoteRequest={newNoteRequest} onOpenProject={openProject} onProjectNotesSaved={() => void refreshProjects()} />
          </div>
          <div className={view === 'knowledge' ? 'view-pane' : 'view-pane hidden'}>
            <KnowledgeView visible={view === 'knowledge'} />
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
            />
          </div>
        </div>
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
            onDelete={(t) => {
              if (window.confirm(`Delete the task "${t.title}"?`)) {
                window.mc.deleteTask(t.id)
                setOpenTaskId(null)
              }
            }}
            onGitChanged={refreshGit}
          />
        )}
        <StatusBar
          indexStatus={indexStatus}
          rateLimit={rateLimit}
          update={update}
          onOpenSettings={() => setSettingsOpen(true)}
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
      {composerOpen && (
        <TaskComposer
          tasks={tasks}
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
            if (then === 'queue') toast('info', 'Added to the queue', queue?.enabled ? task.title : 'Turn on “Auto-run queue” to start it automatically.')
          }}
          onSaveTemplate={saveAsTemplate}
        />
      )}
      {templatesOpen && (
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
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onOpenShortcuts={() => setShortcutsOpen(true)} />}
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
    </LookContext.Provider>
    </ShortcutContext.Provider>
  )
}
