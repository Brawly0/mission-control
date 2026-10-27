import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Maximize2, PanelRightOpen, Shrink, Square, SquareTerminal, TerminalSquare, X } from 'lucide-react'
import type { Task } from '@shared/types'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { elapsed, formatCost } from '../util'
import { EmptyState, IconButton, ToolBadge } from './ui'
import { useLook } from '../projectLook'

// xterm loads with the first terminal shown, not with the board.
const TerminalPane = lazy(() => import('./TerminalPane'))
const TaskConsole = lazy(() => import('./TaskConsole'))

/** Runs that finished since the app opened stay on screen until dismissed, so the end of their output can be read. */
const SESSION_START = Date.now()

interface Props {
  tasks: Task[]
  agents: Agent[]
  visible: boolean
  projectFilter: string
  /** A task whose terminal should be brought forward (from a card's Terminal button). */
  focusId: string | null
  onOpen: (task: Task) => void
  onStop: (task: Task) => void
  onOpenAgent: (agentId: string) => void
}

/** The terminal shown for a task: its agent's own PTY when interactive, the CLI stream when in the background. */
export function TaskTerminal({ task, visible }: { task: Task; visible: boolean }) {
  const agentId = task.mode === 'interactive' ? task.run?.agentId : undefined
  return (
    <Suspense fallback={<div className="muted pad small">Loading terminal…</div>}>
      {agentId ? <TerminalPane id={agentId} visible={visible} autoFocus={false} onExit={() => undefined} /> : task.mode === 'interactive' ? <div className="muted pad small">The agent terminal was closed.</div> : <TaskConsole taskId={task.id} visible={visible} />}
    </Suspense>
  )
}

function TileStatus({ task, agent }: { task: Task; agent?: Agent }) {
  const run = task.run
  if (task.column === 'running') {
    if (agent) {
      const st = displayStatus(agent, undefined)
      return <span className={`task-activity status-${st.cls}`}><span className={`dot ${st.cls}`} /> {st.label}</span>
    }
    return <span className="task-activity"><Loader2 size={12} className="spin" /> <span className="ellipsis">{run?.activity ?? 'Working…'}</span></span>
  }
  return run?.error
    ? <span className="task-activity tone-red"><AlertCircle size={12} /> <span className="ellipsis">{run.error.split('\n')[0]}</span></span>
    : <span className="task-activity tone-green"><CheckCircle2 size={12} /> Finished</span>
}

/** Every running task's terminal side by side, live: what each CLI is doing right now. */
export default function TaskTerminals({ tasks, agents, visible, projectFilter, focusId, onOpen, onStop, onOpenAgent }: Props) {
  const look = useLook()
  /** Dismissed runs, by task id and the run's start: running the task again brings it back. */
  const [dismissed, setDismissed] = useState<Map<string, number>>(new Map())
  const [maximized, setMaximized] = useState<string | null>(null)
  const [, tick] = useState(0)

  // Elapsed times.
  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(timer)
  }, [visible])

  const shown = useMemo(
    () =>
      tasks
        .filter((t) => !t.team && t.run && (t.column === 'running' || t.id === focusId || (t.run.finishedAt ?? 0) >= SESSION_START))
        .filter((t) => t.column === 'running' || t.id === focusId || dismissed.get(t.id) !== t.run!.startedAt)
        .filter((t) => !projectFilter || t.projectPath.toLowerCase() === projectFilter.toLowerCase())
        .sort((a, b) => (a.column === 'running' ? 0 : 1) - (b.column === 'running' ? 0 : 1) || (a.run?.startedAt ?? 0) - (b.run?.startedAt ?? 0)),
    [tasks, dismissed, projectFilter, focusId]
  )
  const max = maximized && shown.some((t) => t.id === maximized) ? maximized : null

  if (!shown.length) {
    return (
      <EmptyState icon={TerminalSquare} title="No task terminals yet">
        <p>Start a task and its terminal opens here, so you can watch Claude or Codex work. Background runs, team agents and interactive tasks all show up live.</p>
      </EmptyState>
    )
  }

  return (
    <div className={`task-terminals ${max ? 'has-max' : ''} count-${Math.min(shown.length, 4)}`}>
      {shown.map((t) => {
        const run = t.run!
        const parent = t.teamParentId ? tasks.find((p) => p.id === t.teamParentId) : undefined
        const agent = run.agentId ? agents.find((a) => a.id === run.agentId) : undefined
        const running = t.column === 'running'
        const hidden = !!max && max !== t.id
        return (
          <section
            key={t.id}
            className={`task-term ${running ? 'is-running' : run.error ? 'has-error' : 'is-done'} ${hidden ? 'stacked-hidden' : ''} ${focusId === t.id ? 'is-focus' : ''}`}
            data-task-id={t.id}
          >
            <header className="task-term-head">
              <ToolBadge tool={t.tool ?? 'claude'} />
              <div className="task-term-title">
                <button className="link-plain ellipsis strong" onClick={() => onOpen(parent ?? t)} title="Open the task">
                  {t.title}
                </button>
                <span className="muted small ellipsis">
                  {parent ? `Team · ${parent.title}` : look(t.projectPath)?.name ?? t.projectName}
                  {t.mode === 'interactive' ? ' · interactive' : ' · background'}
                </span>
              </div>
              <span className="spacer" />
              <span className="muted small task-term-stats">
                {elapsed(run.finishedAt ? Date.now() - (run.finishedAt - run.startedAt) : run.startedAt)}
                {run.toolCalls > 0 && ` · ${run.toolCalls} tools`}
                {run.costUsd ? ` · ${formatCost(run.costUsd)}` : ''}
              </span>
              {running && t.mode === 'headless' && !t.teamParentId && <IconButton icon={Square} size={13} label="Stop the run" onClick={() => onStop(t)} />}
              {agent && <IconButton icon={SquareTerminal} size={13} label="Open in Agents" onClick={() => onOpenAgent(agent.id)} />}
              <IconButton icon={PanelRightOpen} size={13} label="Task details" onClick={() => onOpen(t)} />
              <IconButton icon={max === t.id ? Shrink : Maximize2} size={13} label={max === t.id ? 'Restore' : 'Maximize'} onClick={() => setMaximized(max === t.id ? null : t.id)} />
              {!running && <IconButton icon={X} size={13} label="Dismiss" onClick={() => setDismissed((cur) => new Map(cur).set(t.id, run.startedAt))} />}
            </header>
            <div className="task-term-status">
              <TileStatus task={t} agent={agent} />
            </div>
            <div className="task-term-body">
              <TaskTerminal task={t} visible={visible && !hidden} />
            </div>
          </section>
        )
      })}
    </div>
  )
}
