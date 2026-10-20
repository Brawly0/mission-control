import { useMemo, useState, type DragEvent } from 'react'
import { AlertCircle, CheckCircle2, Circle, CircleDot, GitBranch, Loader2, Play, Plus, Square, SquareTerminal, Zap, ClipboardList, Eye } from 'lucide-react'
import type { Project, Task, TaskColumn } from '@shared/types'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { elapsed, formatCost, timeAgo } from '../util'
import { Avatar, Button, EmptyState } from './ui'

interface Props {
  tasks: Task[]
  agents: Agent[]
  projects: Project[]
  projectFilter: string
  onProjectFilter: (path: string) => void
  onNew: () => void
  onOpen: (task: Task) => void
  onStart: (task: Task) => void
  onStop: (task: Task) => void
  onMove: (task: Task, column: TaskColumn) => void
  onOpenAgent: (agentId: string) => void
}

const COLUMNS: { id: TaskColumn; title: string; icon: typeof Circle; hint: string }[] = [
  { id: 'todo', title: 'To do', icon: Circle, hint: 'Write a task, then press Start.' },
  { id: 'running', title: 'Running', icon: CircleDot, hint: 'Tasks being worked on show live progress here.' },
  { id: 'review', title: 'Review', icon: Eye, hint: 'Finished runs wait here for you to check.' },
  { id: 'done', title: 'Done', icon: CheckCircle2, hint: 'Drag reviewed tasks here.' }
]

function TaskCard({ task, agent, onOpen, onStart, onStop, onOpenAgent }: { task: Task; agent?: Agent } & Pick<Props, 'onOpen' | 'onStart' | 'onStop' | 'onOpenAgent'>) {
  const run = task.run
  const running = task.column === 'running'
  const agentStatus = agent ? displayStatus(agent, undefined) : null

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/task-id', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <article
      className={`task-card ${running ? 'is-running' : ''} ${run?.error && !running ? 'has-error' : ''} ${agentStatus?.cls === 'needs-input' ? 'needs-you' : ''}`}
      draggable={!running || task.mode === 'interactive'}
      onDragStart={onDragStart}
      onClick={() => onOpen(task)}
    >
      <div className="task-card-top">
        <span className="task-title">{task.title}</span>
      </div>
      <div className="task-meta">
        <Avatar name={task.projectName} size={18} />
        <span className="ellipsis">{task.projectName}</span>
        <span className={`mode-badge mode-${task.mode}`} title={task.mode === 'headless' ? 'Runs in the background' : 'Opens an agent terminal'}>
          {task.mode === 'headless' ? <Zap size={11} /> : <SquareTerminal size={11} />}
          {task.mode === 'headless' ? 'Headless' : 'Interactive'}
        </span>
        {task.worktree && (
          <span className="chip chip-accent task-branch" title={task.worktree.path}>
            <GitBranch size={10} /> {task.worktree.branch.replace(/^mc\//, '')}
          </span>
        )}
      </div>

      {running && run && (
        <div className="task-progress">
          {task.mode === 'interactive' && agentStatus ? (
            <span className={`task-activity status-${agentStatus.cls}`}>
              <span className={`dot ${agentStatus.cls}`} /> {agentStatus.label}
            </span>
          ) : (
            <span className="task-activity">
              <Loader2 size={12} className="spin" /> <span className="ellipsis">{run.activity ?? 'Working…'}</span>
            </span>
          )}
          <span className="task-stats muted">
            {elapsed(run.startedAt)}
            {run.toolCalls > 0 && ` · ${run.toolCalls} tool ${run.toolCalls === 1 ? 'call' : 'calls'}`}
          </span>
        </div>
      )}

      {!running && run?.finishedAt && (
        <div className={`task-outcome ${run.error ? 'error' : ''}`}>
          {run.error ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
          <span className="ellipsis">{run.error ?? (run.result?.split('\n').find((l) => l.trim()) || 'Finished')}</span>
        </div>
      )}

      <div className="task-foot" onClick={(e) => e.stopPropagation()}>
        <span className="muted small">
          {run?.costUsd ? `${formatCost(run.costUsd)} · ` : ''}
          {run?.finishedAt ? `finished ${timeAgo(run.finishedAt)}` : `added ${timeAgo(task.createdAt)}`}
        </span>
        {task.column === 'todo' && (
          <Button size="sm" variant="primary" icon={Play} onClick={() => onStart(task)}>
            Start
          </Button>
        )}
        {running && task.mode === 'headless' && (
          <Button size="sm" variant="ghost" icon={Square} onClick={() => onStop(task)}>
            Stop
          </Button>
        )}
        {running && task.mode === 'interactive' && run?.agentId && (
          <Button size="sm" variant="secondary" icon={SquareTerminal} onClick={() => onOpenAgent(run.agentId!)}>
            Open agent
          </Button>
        )}
      </div>
    </article>
  )
}

export default function TasksView(props: Props) {
  const { tasks, agents, projects, projectFilter } = props
  const [dragOver, setDragOver] = useState<TaskColumn | null>(null)

  const visible = useMemo(
    () => tasks.filter((t) => !projectFilter || t.projectPath.toLowerCase() === projectFilter.toLowerCase()),
    [tasks, projectFilter]
  )
  const projectOptions = projects.filter((p) => !p.worktree)

  const onDrop = (e: DragEvent, column: TaskColumn) => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/task-id')
    const task = tasks.find((t) => t.id === id)
    if (!task || task.column === column) return
    // Only Start moves a task into Running; a headless run can't be dragged out while it works.
    if (column === 'running') return
    props.onMove(task, column)
  }

  return (
    <div className="tasks-view">
      <header className="tasks-head">
        <div>
          <h1>Tasks</h1>
          <p className="muted">Queue work for Claude. Headless tasks run in the background; you review the result.</p>
        </div>
        <div className="toolbar">
          <select className="select" value={projectFilter} onChange={(e) => props.onProjectFilter(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projectOptions.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
          <Button variant="primary" icon={Plus} onClick={props.onNew}>
            New task
          </Button>
        </div>
      </header>

      {tasks.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No tasks yet">
          <p>Write down what you want done, pick a project, and press Start. You can run several at once, each in its own worktree.</p>
          <Button variant="primary" icon={Plus} onClick={props.onNew}>
            New task
          </Button>
        </EmptyState>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => {
            const items = visible.filter((t) => t.column === col.id).sort((a, b) => a.order - b.order)
            return (
              <section
                key={col.id}
                className={`board-col col-${col.id} ${dragOver === col.id ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  if (col.id === 'running') return
                  e.preventDefault()
                  setDragOver(col.id)
                }}
                onDragLeave={() => setDragOver((c) => (c === col.id ? null : c))}
                onDrop={(e) => onDrop(e, col.id)}
              >
                <div className="board-col-head">
                  <col.icon size={14} className="col-icon" />
                  <span>{col.title}</span>
                  <span className="count">{items.length}</span>
                  {col.id === 'todo' && (
                    <button className="col-add" onClick={props.onNew} title="New task" aria-label="New task">
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="board-col-body scroll">
                  {items.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      agent={t.run?.agentId ? agents.find((a) => a.id === t.run!.agentId) : undefined}
                      onOpen={props.onOpen}
                      onStart={props.onStart}
                      onStop={props.onStop}
                      onOpenAgent={props.onOpenAgent}
                    />
                  ))}
                  {items.length === 0 && <div className="col-empty muted small">{col.hint}</div>}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
