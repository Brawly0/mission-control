import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Bell,
  Bot,
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
  X
} from 'lucide-react'
import type { GitInfo, IndexStatus, Project, RateLimitInfo, RecentSession, SavedAgent, SearchHit, Task } from '@shared/types'
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

  useEffect(() => {
    window.mc.listTasks().then(setTasks)
    window.mc.getRateLimit().then(setRateLimit)
    const offTasks = window.mc.onTasksChanged(setTasks)
    const offRate = window.mc.onRateLimit(setRateLimit)
    // The tray menu and notifications can send the UI somewhere.
    const offNav = window.mc.onNavigate((target) => {
      setView(target.view as View)
      if (target.newTask) setComposerOpen(true)
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
      setUiLoaded(true)
      refreshProjects()
    })
    window.mc.loadSavedAgents().then(setPendingRestore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (uiLoaded) window.mc.setUiState({ selectedPath: selectedPath ?? undefined, view, layout, showWorktrees })
  }, [uiLoaded, selectedPath, view, layout, showWorktrees])

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
    ;(window as any).__mcSmoke = { launch, agents: () => agentsRef.current, setView, openPalette: () => setPaletteOpen(true), selectProject: setSelectedPath, refresh: refreshProjects, openComposer: () => setComposerOpen(true), openTask: setOpenTaskId, startTask, tasks: () => tasksRef.current }
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
    const match = projectsRef.current.find((p) => p.path.toLowerCase() === path.toLowerCase())
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

  const groups = useMemo(() => [...new Set(projects.map((p) => p.meta.group).filter((g): g is string => !!g))].sort(), [projects])

  const addProject = useCallback(async () => {
    const path = await window.mc.addProject()
    if (path) {
      await refreshProjects()
      openProject(path)
    }
  }, [refreshProjects, openProject])

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
      const inTerminal = (e.target as HTMLElement | null)?.closest?.('.terminal-host')
      // Ctrl+K works everywhere except inside a terminal, where shells use it; Ctrl+Shift+P works everywhere.
      if ((e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k' && !inTerminal) || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p')) {
        e.preventDefault()
        e.stopPropagation()
        openPalette()
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        e.stopPropagation()
        setView('search')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openPalette])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'go-home', group: 'Go to', title: 'Home', icon: House, run: () => setView('home') },
      { id: 'go-agents', group: 'Go to', title: 'Agents', icon: Bot, run: () => setView('agents') },
      { id: 'go-search', group: 'Go to', title: 'Search all chats', hint: 'Ctrl+Shift+F', icon: TextSearch, keywords: 'find full text', run: () => setView('search') },
      { id: 'go-usage', group: 'Go to', title: 'Usage and cost', icon: BarChart3, keywords: 'tokens stats spend', run: () => setView('usage') },
      { id: 'go-tasks', group: 'Go to', title: 'Task board', icon: KanbanSquare, keywords: 'kanban todo', run: () => setView('tasks') },
      { id: 'new-task', group: 'Actions', title: 'New task…', icon: ListPlus, keywords: 'kanban headless background', run: () => setComposerOpen(true) },
      { id: 'settings', group: 'Actions', title: 'Settings', icon: Settings, keywords: 'hotkey shortcut tray', run: () => setSettingsOpen(true) }
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
    for (const s of recentForPalette) {
      list.push({ id: `chat-${s.id}`, group: 'Resume a chat', title: s.title, hint: s.projectName, icon: History, keywords: s.projectName, run: () => resumeRecent(s) })
    }
    return list
  }, [selected, layout, notify, agents, projects, showWorktrees, recentForPalette, newInSelected, launchWorktree, launch, toggleNotify, addProject, refreshProjects, focusAgent, openProject, resumeRecent])

  return (
    <div className="app">
      <Sidebar
        projects={projects}
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
        taskCounts={{
          running: tasks.filter((t) => t.column === 'running').length,
          review: tasks.filter((t) => t.column === 'review').length
        }}
      />
      <main className="main">
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
              visible={view === 'home'}
              onOpenAgent={focusAgent}
              onOpenProject={openProject}
              onResume={resumeRecent}
              onNewSession={(p) => launch({ cwd: p.path, projectName: p.name, projectPath: p.path, title: `${p.name} · new` })}
            />
          </div>
          <div className={view === 'project' ? 'view-pane' : 'view-pane hidden'}>
            {selected ? (
              <ProjectView
                key={selected.path}
                project={selected}
                git={git[selected.path]}
                visible={view === 'project'}
                groups={groups}
                focus={focusSession}
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
          <div className={view === 'tasks' ? 'view-pane' : 'view-pane hidden'}>
            <TasksView
              tasks={tasks}
              agents={agents}
              projects={projects}
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
          projects={projects}
          git={git}
          defaultProject={taskFilter || selectedPath || undefined}
          onCancel={() => setComposerOpen(false)}
          onCreate={async (input, startNow) => {
            setComposerOpen(false)
            setView('tasks')
            const task = await window.mc.createTask(input)
            if (startNow) startTask(task)
          }}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
