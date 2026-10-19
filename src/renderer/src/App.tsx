import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, SavedAgent } from '@shared/types'
import Sidebar from './components/Sidebar'
import ProjectView from './components/ProjectView'
import AgentsView from './components/AgentsView'
import type { Agent, AgentLayout, LaunchOptions } from './types'
import { onActivity } from './terminalBus'
import { statusFromHook } from './agentStatus'

type View = 'project' | 'agents'

function loadNotifyPref(): boolean {
  try {
    return localStorage.getItem('mc.notify') !== 'off'
  } catch {
    return true
  }
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('project')
  const [agents, setAgents] = useState<Agent[]>([])
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [layout, setLayout] = useState<AgentLayout>('tabs')
  const [lastOutput, setLastOutput] = useState<Record<string, number>>({})
  const [notify, setNotify] = useState(loadNotifyPref)
  /** Agents from the last run that haven't been restored or dismissed yet; null until loaded. */
  const [pendingRestore, setPendingRestore] = useState<SavedAgent[] | null>(null)
  const [, setTick] = useState(0)

  // Hook events arrive outside React's render cycle; refs give them current values.
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const uiRef = useRef({ view, activeAgent, notify })
  uiRef.current = { view, activeAgent, notify }

  const refreshProjects = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.mc.listProjects()
      setProjects(list)
      setSelectedPath((cur) => cur ?? list[0]?.path ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshProjects()
    window.mc.loadSavedAgents().then(setPendingRestore)
  }, [refreshProjects])

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
      const ui = uiRef.current
      const lookingAtIt = document.hasFocus() && ui.view === 'agents' && ui.activeAgent === agent.id
      if (change?.notify && ui.notify && !lookingAtIt) {
        const body =
          change.status === 'done' ? 'Finished. Your turn.' : change.message || 'Claude needs your input.'
        const n = new Notification(agent.title, { body, silent: false })
        n.onclick = () => focusAgent(agent.id)
      }
    })
  }, [focusAgent])

  // Remember open agents so they can be reopened after a restart.
  useEffect(() => {
    if (pendingRestore === null) return
    const open: SavedAgent[] = agents
      .filter((a) => !a.exited)
      .map(({ title, cwd, projectName, kind, sessionId }) => ({ title, cwd, projectName, kind, sessionId }))
    window.mc.saveAgents([...pendingRestore, ...open])
  }, [agents, pendingRestore])

  const launch = useCallback(async (opts: LaunchOptions) => {
    const kind = opts.kind ?? 'claude'
    const info = await window.mc.ptySpawn({ cwd: opts.cwd, args: opts.args ?? [], kind, cols: 120, rows: 30 })
    const agent: Agent = {
      id: info.id,
      title: opts.title,
      cwd: opts.cwd,
      projectName: opts.projectName,
      kind,
      sessionId: info.sessionId,
      exited: false,
      startedAt: Date.now()
    }
    setAgents((a) => [...a, agent])
    setActiveAgent(info.id)
    setView('agents')
  }, [])

  const restoreAll = useCallback(async () => {
    const saved = pendingRestore ?? []
    setPendingRestore([])
    for (const s of saved) {
      // A session that never got a prompt has no transcript, so it can't be resumed; start fresh.
      const canResume = s.kind === 'claude' && s.sessionId && (await window.mc.sessionExists(s.sessionId))
      await launch({
        cwd: s.cwd,
        projectName: s.projectName,
        title: s.title,
        kind: s.kind,
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

  const toggleNotify = () => {
    const next = !notify
    setNotify(next)
    try {
      localStorage.setItem('mc.notify', next ? 'on' : 'off')
    } catch {
      /* preference just won't persist */
    }
  }

  const selected = projects.find((p) => p.path === selectedPath) ?? null
  const running = agents.filter((a) => !a.exited).length
  const needYou = agents.filter((a) => !a.exited && (a.hookStatus === 'needs-input' || a.hookStatus === 'done')).length

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        loading={loading}
        selectedPath={selectedPath}
        agents={agents}
        onSelect={(path) => {
          setSelectedPath(path)
          setView('project')
        }}
        onRefresh={refreshProjects}
        onAdd={async () => {
          const path = await window.mc.addProject()
          if (path) {
            await refreshProjects()
            setSelectedPath(path)
          }
        }}
      />
      <main className="main">
        <header className="topbar">
          <nav className="view-switch">
            <button className={view === 'project' ? 'active' : ''} onClick={() => setView('project')}>
              Project
            </button>
            <button className={view === 'agents' ? 'active' : ''} onClick={() => setView('agents')}>
              Agents
              {agents.length > 0 && (
                <span className="badge">
                  {running}/{agents.length}
                </span>
              )}
              {needYou > 0 && (
                <span className="badge attention" title="Agents waiting for you">
                  {needYou}
                </span>
              )}
            </button>
          </nav>
          {pendingRestore && pendingRestore.length > 0 && (
            <div className="restore-banner">
              <span>
                {pendingRestore.length} {pendingRestore.length === 1 ? 'agent' : 'agents'} open last time
              </span>
              <button className="btn small primary" onClick={restoreAll}>
                Restore
              </button>
              <button className="btn small" onClick={() => setPendingRestore([])}>
                Dismiss
              </button>
            </div>
          )}
          <button
            className={`icon-btn notify-toggle ${notify ? 'on' : ''}`}
            onClick={toggleNotify}
            title={notify ? 'Notifications on' : 'Notifications off'}
          >
            {notify ? '🔔' : '🔕'}
          </button>
        </header>
        <div className="view-body">
          <div className={view === 'project' ? 'view-pane' : 'view-pane hidden'}>
            {selected ? (
              <ProjectView key={selected.path} project={selected} onLaunch={launch} onChanged={refreshProjects} />
            ) : (
              <div className="empty">
                {loading ? 'Loading projects…' : 'No projects yet. Add a folder from the sidebar.'}
              </div>
            )}
          </div>
          <div className={view === 'agents' ? 'view-pane' : 'view-pane hidden'}>
            <AgentsView
              agents={agents}
              activeId={activeAgent}
              layout={layout}
              visible={view === 'agents'}
              lastOutput={lastOutput}
              onSelect={setActiveAgent}
              onClose={closeAgent}
              onRename={renameAgent}
              onExit={markExited}
              onLayout={setLayout}
              onNew={() =>
                selected &&
                launch({ cwd: selected.path, projectName: selected.name, title: `${selected.name} · new` })
              }
            />
          </div>
        </div>
      </main>
    </div>
  )
}
