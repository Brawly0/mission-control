import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { AlertCircle, CheckCircle2, GitBranch, MessageSquareText, Play, RotateCcw, Square, SquareTerminal, Terminal, Trash2, Wrench, X, Info } from 'lucide-react'
import type { Task, TaskEvent } from '@shared/types'
import type { Agent } from '../types'
import { elapsed, formatCost } from '../util'
import ChangesPanel from './ChangesPanel'
import { Avatar, Button, IconButton } from './ui'

interface Props {
  task: Task
  agent?: Agent
  onClose: () => void
  onStart: (task: Task) => void
  onStop: (task: Task) => void
  onContinue: (task: Task) => void
  onOpenAgent: (agentId: string) => void
  onDone: (task: Task) => void
  onDelete: (task: Task) => void
  onGitChanged: () => void
}

const EVENT_ICON: Record<TaskEvent['kind'], typeof Info> = {
  start: Play,
  tool: Wrench,
  text: MessageSquareText,
  result: CheckCircle2,
  error: AlertCircle,
  info: Info
}

/** How long a run took (or has been going), formatted like "3m". */
function duration(from: number, to?: number): string {
  return elapsed(Date.now() - ((to ?? Date.now()) - from))
}

export default function TaskDrawer({ task, agent, onClose, onStart, onStop, onContinue, onOpenAgent, onDone, onDelete, onGitChanged }: Props) {
  const [tab, setTab] = useState<'activity' | 'changes'>('activity')
  const [prompt, setPrompt] = useState(task.prompt)
  const [title, setTitle] = useState(task.title)
  const run = task.run
  const running = task.column === 'running'
  const editable = task.column === 'todo'

  useEffect(() => {
    setPrompt(task.prompt)
    setTitle(task.title)
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const saveText = () => {
    if (title !== task.title || prompt !== task.prompt) window.mc.updateTask(task.id, { title: title.trim() || task.title, prompt })
  }

  return (
    <aside className="drawer" role="dialog" aria-label={task.title}>
      <div className="drawer-head">
        {editable ? (
          <input className="drawer-title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveText} />
        ) : (
          <h2 className="drawer-title">{task.title}</h2>
        )}
        <IconButton icon={X} label="Close" onClick={onClose} />
      </div>

      <div className="drawer-meta">
        <span className="chip">
          <Avatar name={task.projectName} size={14} /> {task.projectName}
        </span>
        <span className="chip">{task.mode === 'headless' ? 'Headless' : 'Interactive'}</span>
        <span className="chip">{task.permission === 'bypassPermissions' ? 'Bypass checks' : task.permission}</span>
        {task.model && <span className="chip">{task.model}</span>}
        {task.budgetUsd && <span className="chip">Budget {formatCost(task.budgetUsd)}</span>}
        {task.worktree && (
          <span className="chip chip-accent">
            <GitBranch size={11} /> {task.worktree.branch}
          </span>
        )}
      </div>

      <div className="drawer-actions">
        {task.column === 'todo' && (
          <Button variant="primary" icon={Play} onClick={() => onStart(task)}>
            Start
          </Button>
        )}
        {running && task.mode === 'headless' && (
          <Button icon={Square} onClick={() => onStop(task)}>
            Stop
          </Button>
        )}
        {running && task.mode === 'interactive' && run?.agentId && (
          <Button variant="primary" icon={SquareTerminal} onClick={() => onOpenAgent(run.agentId!)}>
            Open agent
          </Button>
        )}
        {!running && run?.sessionId && (
          <Button variant="primary" icon={Terminal} onClick={() => onContinue(task)} title="Open this run's chat in an agent terminal to follow up">
            Continue in terminal
          </Button>
        )}
        {!running && run && (
          <Button icon={RotateCcw} onClick={() => onStart(task)} title="Run the same prompt again">
            Run again
          </Button>
        )}
        {task.column === 'review' && (
          <Button icon={CheckCircle2} onClick={() => onDone(task)}>
            Mark done
          </Button>
        )}
        <span className="spacer" />
        <IconButton icon={Trash2} label="Delete task" onClick={() => onDelete(task)} disabled={running && task.mode === 'headless'} />
      </div>

      {run && (
        <div className="run-stats">
          <div>
            <span className="muted small">Status</span>
            <span className={run.error ? 'tone-red' : running ? 'tone-green' : ''}>
              {running ? (agent ? agent.hookStatus ?? 'running' : 'running') : run.error ? 'stopped' : 'finished'}
            </span>
          </div>
          <div>
            <span className="muted small">Time</span>
            <span>{duration(run.startedAt, run.finishedAt)}</span>
          </div>
          <div>
            <span className="muted small">Tool calls</span>
            <span>{run.toolCalls}</span>
          </div>
          <div>
            <span className="muted small">Cost</span>
            <span>{run.costUsd !== undefined ? formatCost(run.costUsd) : '–'}</span>
          </div>
        </div>
      )}

      <nav className="page-tabs drawer-tabs">
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
          Task &amp; activity
        </button>
        <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')} disabled={!task.worktree} title={task.worktree ? '' : 'Only for tasks run in a worktree'}>
          Changes
        </button>
      </nav>

      {tab === 'changes' && task.worktree ? (
        <div className="drawer-changes">
          <ChangesPanel path={task.worktree.path} worktree={task.worktree} visible onChanged={onGitChanged} />
        </div>
      ) : (
        <div className="drawer-body scroll">
          <section>
            <h3>Prompt</h3>
            {editable ? (
              <textarea className="prompt-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={saveText} rows={5} />
            ) : (
              <div className="prompt-view">{task.prompt}</div>
            )}
          </section>

          {run?.error && (
            <section className="run-error">
              <AlertCircle size={15} />
              <div>{run.error}</div>
            </section>
          )}

          {run?.result && (
            <section>
              <h3>Result</h3>
              <div className="markdown result-view">
                <Markdown>{run.result}</Markdown>
              </div>
            </section>
          )}

          {run && run.events.length > 0 && (
            <section>
              <h3>Activity</h3>
              <ol className="timeline">
                {run.events.map((ev, i) => {
                  const Icon = EVENT_ICON[ev.kind]
                  return (
                    <li key={i} className={`ev ev-${ev.kind}`}>
                      <Icon size={13} />
                      <span className="ev-text">{ev.kind === 'text' ? ev.text.split('\n').slice(0, 4).join('\n') : ev.text}</span>
                      <span className="ev-time muted">{new Date(ev.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}
          {task.mode === 'interactive' && running && <p className="muted">This task runs in an agent terminal. Open it to follow along.</p>}
        </div>
      )}
    </aside>
  )
}
