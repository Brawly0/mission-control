import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import Sidebar from './components/Sidebar'
import ProjectView from './components/ProjectView'
import AgentsView from './components/AgentsView'
import type { Agent, AgentLayout, LaunchOptions } from './types'
import { onActivity } from './terminalBus'

type View = 'project' | 'agents'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [view, setView] = useState<View>('project')
  const [agents, setAgents] = useState<Agent[]>([])
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [layout, setLayout] = useState<AgentLayout>('tabs')
  const [lastOutput, setLastOutput] = useState<Record<string, number>>({})
  const [, setTick] = useState(0)

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
  }, [refreshProjects])

  // Track when each terminal last printed output, to show working / idle lights.
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

  const launch = useCallback(async (opts: LaunchOptions) => {
    const info = await window.mc.ptySpawn({
      cwd: opts.cwd,
      args: opts.args ?? [],
      kind: opts.kind ?? 'claude',
      cols: 120,
      rows: 30
    })
    const agent: Agent = {
      id: info.id,
      title: opts.title,
      cwd: opts.cwd,
      projectName: opts.projectName,
      kind: opts.kind ?? 'claude',
      exited: false,
      startedAt: Date.now()
    }
    setAgents((a) => [...a, agent])
    setActiveAgent(info.id)
    setView('agents')
  }, [])

  const closeAgent = useCallback((id: string) => {
    window.mc.ptyKill(id)
    setAgents((list) => {
      const next = list.filter((a) => a.id !== id)
      setActiveAgent((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur))
      return next
    })
  }, [])

  const markExited = useCallback((id: string, code: number) => {
    setAgents((list) => list.map((a) => (a.id === id ? { ...a, exited: true, exitCode: code } : a)))
  }, [])

  const selected = projects.find((p) => p.path === selectedPath) ?? null
  const running = agents.filter((a) => !a.exited).length

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
            </button>
          </nav>
          <div className="topbar-title">Mission Control</div>
        </header>
        <div className="view-body">
          <div className={view === 'project' ? 'view-pane' : 'view-pane hidden'}>
            {selected ? (
              <ProjectView
                key={selected.path}
                project={selected}
                onLaunch={launch}
                onChanged={refreshProjects}
              />
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
