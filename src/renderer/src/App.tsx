import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import type {
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
  PlanRate
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
import type { AgentLayout, View } from './types'
import { useToast } from './toast'
import { errorMessage } from './util'
import { LookContext, makeLookUp } from './projectLook'
import { ShortcutContext, allowedIn, bindingIndex, comboFromEvent, effectiveKeys } from './shortcuts'
import ShortcutsDialog from './components/ShortcutsDialog'
import TopBar from './components/TopBar'
import SkillsView from './components/SkillsView'
import ProjectsView from './components/ProjectsView'
import NotebookView from './components/NotebookView'
import KnowledgeView from './components/KnowledgeView'
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

export default function App() {
  const toast = useToast()
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
      if (ui.inboxDismissed) setInboxDismissed(ui.inboxDismissed)
      setUiLoaded(true)
      refreshProjects()
    })
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

  const { tasks, tasksRef, startTask, saveAsTemplate, continueTask } = useTasks({ agents, launch, toast })

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
      await launch({ cwd: s.cwd || project.path, projectName: project.name, projectPath: project.path, title: s.title.slice(0, 48), args: ['--resume', s.id] })
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
    tasks,
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
    launch({ cwd: p.path, projectName: p.name, projectPath: p.path, title: `${p.name} · from briefing`, args: [briefingPrompt(path)] })
  }

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
    [workspaces, update, selected, layout, notify, agents, projects, showWorktrees, recentForPalette, newInSelected, launchWorktree, launch, toggleNotify, addProject, refreshProjects, focusAgent, openProject, resumeRecent, shortcutKeys] // eslint-disable-line react-hooks/exhaustive-deps
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
        onOpenTemplates={() => setTemplatesOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        inbox={inboxBadge}
        taskCounts={{
          running: tasks.filter((t) => t.column === 'running').length,
          review: tasks.filter((t) => t.column === 'review').length
        }}
      />
      <main className="main">
        <TopBar theme={theme} userName={userName} currentProject={selected?.name}
          rateLimit={rateLimit}
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
          <div className={view === 'skills' ? 'view-pane' : 'view-pane hidden'}>
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
          </div>
          <div className={view === 'knowledge' ? 'view-pane' : 'view-pane hidden'}>
            <KnowledgeView visible={view === 'knowledge'} onStartFromBriefing={(projectPath, file) => void startFromBriefing(projectPath, file)} />
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
      {broadcastOpen && <BroadcastDialog agents={agents.filter((a) => a.kind === 'claude' && !a.exited)} lastOutput={lastOutput} onClose={() => setBroadcastOpen(false)} />}
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
      {settingsOpen && <SettingsDialog initialTab={settingsTab} onClose={() => {
        setSettingsOpen(false)
        setSettingsTab(undefined)
      }} onOpenShortcuts={() => setShortcutsOpen(true)} />}
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
