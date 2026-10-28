import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Loader2, Maximize2, PanelRightOpen, Rows2, Shrink, Square, TerminalSquare, Users } from 'lucide-react'
import type { Task } from '@shared/types'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { elapsed, formatCost } from '../util'
import { EmptyState, IconButton, ToolBadge } from './ui'
import { TaskTerminal } from './TaskTerminal'
import { taskWorkspaces, workspaceAgentStatus } from '../taskWorkspace'

interface Props {
  tasks: Task[]
  agents: Agent[]
  visible: boolean
  projectFilter: string
  focusId: string | null
  focusRequest: number
  onOpen: (task: Task) => void
  onStop: (task: Task) => void
}

/** One task's planner, workers and integrator, using their actual task-runner streams. */
export default function TaskAgentWorkspace({ tasks, agents, visible, projectFilter, focusId, focusRequest, onOpen, onStop }: Props) {
  const groups = useMemo(() => taskWorkspaces(tasks, projectFilter), [tasks, projectFilter])
  const [rootId, setRootId] = useState<string | null>(null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [layout, setLayout] = useState<'tabs' | 'grid'>(() => {
    try { return localStorage.getItem('mc.taskAgentLayout') === 'grid' ? 'grid' : 'tabs' } catch { return 'tabs' }
  })
  const [maximized, setMaximized] = useState<string | null>(null)
  const tabStrip = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)

  // Explicit navigation wins. Streamed updates must not reset a manually selected tab.
  useEffect(() => {
    if (!focusId) return
    const focus = tasks.find(t => t.id === focusId)
    if (!focus) return
    setRootId(focus.teamParentId ?? focus.id)
    setAgentId(focus.team ? null : focus.id)
    setMaximized(null)
  }, [focusId, focusRequest])

  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => tick(n => n + 1), 5000)
    return () => clearInterval(timer)
  }, [visible])

  const group = groups.find(g => g.root.id === rootId) ?? groups.find(g => g.root.column === 'running') ?? groups[0]
  const members = group?.agents ?? []
  const active = members.find(t => t.id === agentId) ?? members.find(t => t.column === 'running') ?? members[0]
  const max = members.some(t => t.id === maximized) ? maximized : null

  useEffect(() => {
    if (!visible) return
    const strip = tabStrip.current
    if (!strip) return
    const reveal = () => {
      const tab = [...strip.querySelectorAll<HTMLElement>('[data-member-id]')].find(t => t.dataset.memberId === active?.id)
      tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [active?.id, visible])

  if (!group) return <EmptyState icon={TerminalSquare} title="No task agents yet"><p>Start a task or split it into agents. Its agents will appear here in Tabs or Grid.</p></EmptyState>

  const select = (id: string) => { setAgentId(id); setMaximized(null) }
  const setMode = (mode: 'tabs' | 'grid') => {
    setLayout(mode); setMaximized(null)
    try { localStorage.setItem('mc.taskAgentLayout', mode) } catch { /* optional preference */ }
  }

  return <div className="task-agent-workspace">
    <div className="task-workspace-toolbar">
      <Users size={16} />
      <select className="select task-workspace-picker" aria-label="Task agent workspace" value={group.root.id} onChange={e => { setRootId(e.target.value); setAgentId(null); setMaximized(null) }}>
        {groups.map(g => <option key={g.root.id} value={g.root.id}>{g.root.title} · {g.agents.length} agent{g.agents.length === 1 ? '' : 's'}</option>)}
      </select>
      <span className="task-workspace-summary muted small">{members.filter(t => t.column === 'running').length} working · {group.root.team?.phase ?? group.root.column}</span>
      <IconButton icon={PanelRightOpen} label="Task and team controls" onClick={() => onOpen(group.root)} />
      <div className="segmented task-agent-layout" role="group" aria-label="Task agents layout">
        <button type="button" aria-pressed={layout === 'tabs'} className={layout === 'tabs' ? 'active' : ''} onClick={() => setMode('tabs')}><Rows2 size={14} /> Tabs</button>
        <button type="button" aria-pressed={layout === 'grid'} className={layout === 'grid' ? 'active' : ''} onClick={() => setMode('grid')}><LayoutGrid size={14} /> Grid</button>
      </div>
    </div>
    <div className="task-agent-tabs" ref={tabStrip} role="tablist" aria-label="Task agents" onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || !active) return
      e.preventDefault()
      const index = members.indexOf(active)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? members.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + members.length) % members.length
      select(members[next].id)
      tabStrip.current?.querySelector<HTMLButtonElement>(`[data-member-id="${members[next].id}"]`)?.focus()
    }}>
      {members.map((t, index) => {
        const status = workspaceAgentStatus(t, tasks)
        return <button key={t.id} type="button" role="tab" id={`task-agent-tab-${t.id}`} aria-selected={active?.id === t.id} aria-controls={`task-agent-panel-${t.id}`} tabIndex={active?.id === t.id ? 0 : -1} data-member-id={t.id} className={`task-agent-tab ${active?.id === t.id ? 'active' : ''}`} title={`${t.title}\n${status.label}: ${status.detail}`} onClick={() => select(t.id)}>
          <span className={`task-agent-dot ${status.tone}`} /><ToolBadge tool={t.tool ?? 'claude'} />
          <span className="ellipsis">{t.teamRole === 'planner' ? 'Planner' : t.teamRole === 'integrator' ? 'Final integration' : t.teamRole === 'worker' ? `Agent ${index} · ${t.title}` : t.title}</span>
          <span className="task-agent-tab-status">{status.label}</span>
        </button>
      })}
    </div>
    {!members.length && <div className="muted pad">Review the plan and start the team from Task and team controls.</div>}
    <div className={`task-terminals task-agent-stage ${layout} ${max ? 'has-max' : ''} count-${Math.min(members.length, 4)}`}>
      {members.map(t => {
        const run = t.run
        const status = workspaceAgentStatus(t, tasks)
        const agent = run?.agentId ? agents.find(a => a.id === run.agentId) : undefined
        const hidden = max ? t.id !== max : layout === 'tabs' && t.id !== active?.id
        return <section key={t.id} id={`task-agent-panel-${t.id}`} role={layout === 'tabs' ? 'tabpanel' : 'region'} aria-labelledby={`task-agent-tab-${t.id}`} className={`task-term ${t.column === 'running' ? 'is-running' : status.tone === 'error' ? 'has-error' : 'is-done'} ${hidden ? 'stacked-hidden' : ''}`} data-task-id={t.id}>
          <header className="task-term-head">
            <ToolBadge tool={t.tool ?? 'claude'} />
            <div className="task-term-title"><button className="link-plain ellipsis strong" onClick={() => onOpen(t)} title="Open assignment details">{t.title}</button><span className="muted small">{t.teamRole ?? 'Task agent'} · {t.mode === 'interactive' ? 'Interactive terminal' : 'Coordinated run · read-only'}</span></div>
            <span className="spacer" />
            {run && <span className="muted small task-term-stats">{elapsed(run.finishedAt ? Date.now() - (run.finishedAt - run.startedAt) : run.startedAt)}{run.toolCalls > 0 && ` · ${run.toolCalls} tools`}{run.costUsd ? ` · ${formatCost(run.costUsd)}` : ''}</span>}
            {t.column === 'running' && t.mode === 'headless' && !t.teamParentId && <IconButton icon={Square} size={13} label="Stop the run" onClick={() => onStop(t)} />}
            <IconButton icon={PanelRightOpen} size={13} label="Assignment details" onClick={() => onOpen(t)} />
            {layout === 'grid' && <IconButton icon={max === t.id ? Shrink : Maximize2} size={13} label={max === t.id ? 'Restore' : 'Maximize'} onClick={() => { setAgentId(t.id); setMaximized(max === t.id ? null : t.id) }} />}
          </header>
          <div className="task-term-status" role="status">{t.column === 'running' && <Loader2 size={12} className="spin" />}<span className="ellipsis">{agent ? displayStatus(agent, undefined).label : status.label} · {status.detail}</span></div>
          <div className="task-term-body">{run ? <TaskTerminal task={t} visible={visible && !hidden} /> : <div className="task-agent-waiting"><Users size={28} /><strong>{status.label}</strong><p>{status.detail}</p><details><summary>Assigned task</summary><p>{t.prompt}</p></details></div>}</div>
        </section>
      })}
    </div>
  </div>
}
