import { useMemo, useState, type DragEvent } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardList,
  Eye,
  FileStack,
  GitBranch,
  Link2,
  Lock,
  Unlock,
  XCircle,
  ListOrdered,
  ListPlus,
  ListX,
  Loader2,
  Play,
  Plus,
  Repeat,
  Square,
  SquareTerminal,
  Users,
  Zap, CalendarClock, LayoutGrid, TerminalSquare } from 'lucide-react'
import type { Project, QueueStatus, Task, TaskColumn } from '@shared/types'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { dependencyState, dependentsOf } from '@shared/deps'
import { elapsed, formatCost, timeAgo } from '../util'
import { Avatar, Button, EmptyState, ToolBadge } from './ui'
import { useKeyFor, withKey } from '../shortcuts'
import { dueLabel } from '../due'
import { useLook } from '../projectLook'
import { PlanShare } from '../planRate'
import TaskAgentWorkspace from './TaskAgentWorkspace'

export type TasksLayout = 'board' | 'terminals'

interface Props {
  tasks: Task[]
  agents: Agent[]
  projects: Project[]
  queue: QueueStatus | null
  onQueueSettings: (patch: { queueEnabled?: boolean; queueParallel?: number }) => void
  onToggleQueued: (task: Task) => void
  onOpenTemplates: () => void
  projectFilter: string
  onProjectFilter: (path: string) => void
  onNew: () => void
  onOpen: (task: Task) => void
  onStart: (task: Task) => void
  onStop: (task: Task) => void
  onMove: (task: Task, column: TaskColumn) => void
  onOpenAgent: (agentId: string) => void
  visible: boolean
  /** Board of cards, or the live terminals of running tasks. */
  layout: TasksLayout
  onLayout: (layout: TasksLayout) => void
  /** Shows one task's live terminal. */
  onShowTerminal: (task: Task) => void
  terminalFocus: string | null
  terminalFocusRequest: number
}

const COLUMNS: { id: TaskColumn; title: string; icon: typeof Circle; hint: string }[] = [
  { id: 'todo', title: 'To do', icon: Circle, hint: 'Write a task, then press Start.' },
  { id: 'running', title: 'Running', icon: CircleDot, hint: 'Tasks being worked on show live progress here.' },
  { id: 'review', title: 'Review', icon: Eye, hint: 'Finished runs wait here for you to check.' },
  { id: 'done', title: 'Done', icon: CheckCircle2, hint: 'Drag reviewed tasks here.' }
]

function TaskCard({
  task,
  all,
  agent,
  queuePos,
  onOpen,
  onStart,
  onStop,
  onOpenAgent,
  onToggleQueued,
  onShowTerminal
}: { task: Task; all: Task[]; agent?: Agent; queuePos?: number } & Pick<Props, 'onOpen' | 'onStart' | 'onStop' | 'onOpenAgent' | 'onToggleQueued' | 'onShowTerminal'>) {
  const look = useLook()
  const run = task.run
  const running = task.column === 'running'
  const agentStatus = agent ? displayStatus(agent, undefined) : null
  const deps = dependencyState(task, all)
  const waiting = task.column === 'todo' && (deps.kind === 'waiting' || deps.kind === 'blocked')
  const unlocks = dependentsOf(task.id, all).filter((t) => t.column === 'todo')
  const checks = run?.checks

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/task-id', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <article
      className={`task-card ${running ? 'is-running' : ''} ${run?.error && !running ? 'has-error' : ''} ${agentStatus?.cls === 'needs-input' ? 'needs-you' : ''}`}
      draggable={!task.team && (!running || task.mode === 'interactive')}
      onDragStart={onDragStart}
      onClick={() => task.team ? onShowTerminal(task) : onOpen(task)}
    >
      <div className="task-card-top">
        <ToolBadge tool={task.tool ?? 'claude'} /><span className="task-title">{task.title}</span>
        {task.queued && queuePos !== undefined && (
          <span className="queue-badge" title="Waiting in the auto-queue">
            <ListOrdered size={11} /> #{queuePos}
          </span>
        )}
        {task.templateId && <Repeat size={12} className="muted template-mark" aria-label="From a template" />}
        {task.team && <Users size={14} aria-label="Agent team" />}
      </div>
      <div className="task-meta">
        <Avatar name={task.projectName} path={task.projectPath} size={18} />
        <span className="ellipsis">{look(task.projectPath)?.name ?? task.projectName}</span>
        <span className={`mode-badge mode-${task.mode}`} title={task.mode === 'headless' ? 'Runs in the background' : 'Opens an agent terminal'}>
          {task.mode === 'headless' ? <Zap size={11} /> : <SquareTerminal size={11} />}
          {task.mode === 'headless' ? 'Headless' : 'Interactive'}
        </span>
        {task.dueAt && task.column !== 'done' && (
          <span className={`due-chip ${dueLabel(task).tone}`} title={`Due ${new Date(task.dueAt).toLocaleString()}`}>
            <CalendarClock size={10} /> {dueLabel(task).text}
          </span>
        )}
        {task.worktree && (
          <span className="chip chip-accent task-branch" title={task.worktree.path}>
            <GitBranch size={10} /> {task.worktree.branch.replace(/^mc\//, '')}
          </span>
        )}
      </div>

      {task.team && <div className="dep-chip" role="status"><Users size={12} /><span className="ellipsis">{task.team.error || task.team.holdReason || (task.team.phase === 'planning' ? 'Planning the team…' : task.team.phase === 'ready' ? `${task.team.plan?.agents.length ?? 0} agents ready to start` : task.team.phase === 'review' ? 'Team finished · review combined changes' : run?.activity || task.team.phase)}</span></div>}

      {task.column === 'todo' && deps.kind !== 'none' && (
        <div className={`dep-chip dep-${deps.kind}`} title={(task.dependsOn ?? []).map((id) => all.find((t) => t.id === id)?.title ?? '(deleted)').join('\n')}>
          {deps.kind === 'ready' ? <Unlock size={11} /> : <Lock size={11} />}
          <span className="ellipsis">
            {deps.kind === 'blocked'
              ? `Blocked: ${deps.failed.map((t) => t.title).join(', ')} failed`
              : deps.kind === 'waiting'
                ? `Waiting on: ${deps.waitingOn.map((t) => t.title).join(', ')}`
                : 'Ready: everything before it succeeded'}
          </span>
        </div>
      )}
      {unlocks.length > 0 && task.column !== 'done' && (
        <div className="dep-chip dep-unlocks" title={unlocks.map((t) => t.title).join('\n')}>
          <Link2 size={11} />
          <span className="ellipsis">Then: {unlocks.map((t) => t.title).join(', ')}</span>
        </div>
      )}

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
      {checks && (
        <div className={`check-badge check-${checks.status}`} title={`${checks.command}\n\n${checks.output.slice(-600)}`}>
          {checks.status === 'running' ? <Loader2 size={11} className="spin" /> : checks.status === 'passed' ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          <span className="ellipsis">
            {checks.status === 'running' ? 'Running checks…' : checks.status === 'passed' ? 'Checks passed' : `Checks ${checks.status}`}: <code>{checks.command}</code>
          </span>
        </div>
      )}

      <div className="task-foot" onClick={(e) => e.stopPropagation()}>
        <span className="muted small">
          {run?.costUsd ? formatCost(run.costUsd) : ''}
          {run?.costUsd ? <PlanShare usd={run.costUsd} prefix=" " /> : null}
          {run?.costUsd ? ' · ' : ''}
          {run?.finishedAt ? `finished ${timeAgo(run.finishedAt)}` : `added ${timeAgo(task.createdAt)}`}
        </span>
        {task.team && <><Button size="sm" icon={Users} onClick={() => onShowTerminal(task)}>Watch agents</Button><Button size="sm" onClick={() => onOpen(task)}>Team controls</Button></>}
        {!task.team && task.column === 'todo' && task.mode === 'headless' && (
          <Button
            size="sm"
            variant="ghost"
            icon={task.queued ? ListX : ListPlus}
            onClick={() => onToggleQueued(task)}
            title={task.queued ? 'Take it out of the queue' : 'Run it automatically when the queue has a free slot'}
          >
            {task.queued ? 'Unqueue' : 'Queue'}
          </Button>
        )}
        {!task.team && task.column === 'todo' && !waiting && (
          <Button size="sm" variant="primary" icon={Play} onClick={() => onStart(task)}>
            Start
          </Button>
        )}
        {waiting && (
          <Button size="sm" variant="ghost" icon={Lock} onClick={() => onOpen(task)} title="Open it to run it anyway">
            {deps.kind === 'blocked' ? 'Blocked' : 'Waiting'}
          </Button>
        )}
        {!task.team && running && (task.mode === 'headless' || run?.agentId) && (
          <Button size="sm" variant="secondary" icon={TerminalSquare} onClick={() => onShowTerminal(task)} title="Watch its terminal live">
            Terminal
          </Button>
        )}
        {!task.team && running && task.mode === 'headless' && (
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
  const keyFor = useKeyFor()

  const visible = useMemo(
    () => tasks.filter((t) => !t.teamParentId && (!projectFilter || t.projectPath.toLowerCase() === projectFilter.toLowerCase())),
    [tasks, projectFilter]
  )
  const projectOptions = projects.filter((p) => !p.worktree)
  const runningCount = tasks.filter((t) => t.column === 'running' && !t.team).length
  // Queue positions across all projects, in the order the queue will run them.
  const queueOrder = useMemo(
    () =>
      new Map(
        tasks
          .filter((t) => t.column === 'todo' && t.queued)
          .sort((a, b) => a.order - b.order)
          .map((t, i) => [t.id, i + 1])
      ),
    [tasks]
  )

  const onDrop = (e: DragEvent, column: TaskColumn) => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/task-id')
    const task = tasks.find((t) => t.id === id)
    if (!task || task.team || task.teamParentId || task.column === column) return
    // Only Start moves a task into Running; a headless run can't be dragged out while it works.
    if (column === 'running') return
    props.onMove(task, column)
  }

  return (
    <div className="tasks-view">
      <header className="tasks-head">
        <div>
          <h1>Tasks</h1>
          <p className="muted">Give a task to Claude or Codex, then watch its agents work in Tabs or Grid.</p>
        </div>
        <div className="toolbar">
          <div className="segmented tasks-layout-switch" role="group" aria-label="Tasks layout">
            <button type="button" aria-pressed={props.layout === 'board'} className={props.layout === 'board' ? 'active' : ''} onClick={() => props.onLayout('board')} title="Task board">
              <LayoutGrid size={14} strokeWidth={2} />
              <span>Board</span>
            </button>
            <button type="button" aria-pressed={props.layout === 'terminals'} className={props.layout === 'terminals' ? 'active' : ''} onClick={() => props.onLayout('terminals')} title="Live terminals of running tasks">
              <TerminalSquare size={14} strokeWidth={2} />
              <span>Task agents</span>
              {runningCount > 0 && <span className="count-pill">{runningCount}</span>}
            </button>
          </div>
          {props.queue && (
            <div className={`queue-control ${props.queue.enabled ? 'on' : ''}`} title={props.queue.heldBecause ?? 'Queued tasks start by themselves'}>
              <label className="switch" title={props.queue.enabled ? 'Pause the queue' : 'Run queued tasks automatically'}>
                <input type="checkbox" checked={props.queue.enabled} onChange={(e) => props.onQueueSettings({ queueEnabled: e.target.checked })} />
                <span />
              </label>
              <span className="queue-label">
                Auto-run queue
                <span className="muted small">
                  {props.queue.queued} queued
                  {props.queue.enabled && props.queue.heldBecause ? ` · held: ${props.queue.heldBecause}` : ''}
                </span>
              </span>
              <select
                className="select select-sm"
                value={props.queue.parallel}
                onChange={(e) => props.onQueueSettings({ queueParallel: Number(e.target.value) })}
                aria-label="How many at once"
                title="How many queued tasks may run at the same time"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} at a time
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button variant="secondary" icon={FileStack} onClick={props.onOpenTemplates} title={withKey('Templates and schedules', keyFor('templates'))}>
            Templates
          </Button>
          <select className="select project-filter" value={projectFilter} onChange={(e) => props.onProjectFilter(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projectOptions.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
          <Button variant="primary" icon={Plus} onClick={props.onNew} title={withKey('New task', keyFor('newTask'))}>
            New task
          </Button>
        </div>
      </header>

      {/* Keep the workspace mounted so selection and terminal output survive Board switches. */}
      <div className={props.layout === 'terminals' ? 'task-terminals-pane' : 'task-terminals-pane hidden'}>
        <TaskAgentWorkspace
          tasks={tasks}
          agents={agents}
          visible={props.visible && props.layout === 'terminals'}
          projectFilter={projectFilter}
          focusId={props.terminalFocus}
          focusRequest={props.terminalFocusRequest}
          onOpen={props.onOpen}
          onStop={props.onStop}
        />
      </div>
      {props.layout === 'terminals' ? null : tasks.length === 0 ? (
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
                      all={tasks}
                      agent={t.run?.agentId ? agents.find((a) => a.id === t.run!.agentId) : undefined}
                      queuePos={queueOrder.get(t.id)}
                      onOpen={props.onOpen}
                      onStart={props.onStart}
                      onStop={props.onStop}
                      onOpenAgent={props.onOpenAgent}
                      onToggleQueued={props.onToggleQueued}
                      onShowTerminal={props.onShowTerminal}
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
