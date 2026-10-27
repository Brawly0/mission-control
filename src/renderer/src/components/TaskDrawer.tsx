import { useEffect, useState } from 'react'
import { Md } from './Md'
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  GitCommitHorizontal,
  Link2,
  Loader2,
  Lock,
  MessageSquareText,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  SquareTerminal,
  Terminal,
  Trash2,
  Users,
  Wrench,
  X,
  XCircle,
  Info, CalendarClock } from 'lucide-react'
import type { Task, TaskEvent } from '@shared/types'
import { dependencyState, dependentsOf, taskFailed, taskSucceeded } from '@shared/deps'
import type { Agent } from '../types'
import { elapsed, errorMessage, formatCost } from '../util'
import { useToast } from '../toast'
import ChangesPanel from './ChangesPanel'
import TaskTeamPanel from './TaskTeamPanel'
import { Avatar, Button, IconButton, ToolBadge } from './ui'
import { useLook } from '../projectLook'
import { dueFrom, dueInputs, dueLabel } from '../due'
import { PlanShare } from '../planRate'

interface Props {
  task: Task
  /** All tasks, for the dependency chain. */
  all: Task[]
  onOpenTask: (task: Task) => void
  /** Opens New task with this task as its "run after". */
  onAddAfter: (task: Task) => void
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

function statusIcon(t: Task) {
  if (t.column === 'running') return <Loader2 size={12} className="spin tone-green" />
  if (taskSucceeded(t)) return <CheckCircle2 size={12} className="tone-green" />
  if (taskFailed(t)) return <XCircle size={12} className="tone-red" />
  return <Lock size={12} className="muted" />
}

export default function TaskDrawer({ task, all, onOpenTask, onAddAfter, agent, onClose, onStart, onStop, onContinue, onOpenAgent, onDone, onDelete, onGitChanged }: Props) {
  const look = useLook()
  const toast = useToast()
  const [tab, setTab] = useState<'activity' | 'changes'>('activity')
  const [prompt, setPrompt] = useState(task.prompt)
  const [title, setTitle] = useState(task.title)
  const [followUp, setFollowUp] = useState('')
  const [planning, setPlanning] = useState(false)
  const run = task.run
  const running = task.column === 'running'
  const managed = !!task.team || !!task.teamParentId
  const editable = task.column === 'todo' && !managed
  const canChanges = !!task.worktree && (!task.team || task.team.phase === 'review')
  const deps = dependencyState(task, all)
  const before = (task.dependsOn ?? []).map((id) => all.find((t) => t.id === id)).filter((t): t is Task => !!t)
  const after = dependentsOf(task.id, all)
  const canFollowUp = !managed && task.mode === 'headless' && !running && !!run?.sessionId && !!run.finishedAt

  const splitTeam = async () => {
    setPlanning(true)
    try {
      await window.mc.updateTask(task.id, { title: title.trim() || task.title, prompt })
      await window.mc.planTaskTeam(task.id)
    } catch (e) { toast('error', 'Could not split the task into agents', errorMessage(e)) }
    finally { setPlanning(false) }
  }

  const sendFollowUp = async () => {
    try {
      await window.mc.followUpTask(task.id, followUp)
      setFollowUp('')
    } catch (e) {
      toast('error', 'Could not send the follow-up', errorMessage(e))
    }
  }
  const rerunChecks = async () => {
    try {
      await window.mc.rerunChecks(task.id)
    } catch (e) {
      toast('error', 'Could not run the checks', errorMessage(e))
    }
  }

  useEffect(() => {
    setPrompt(task.prompt)
    setTitle(task.title)
    setTab('activity')
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
          <h2 className="drawer-title"><ToolBadge tool={task.tool ?? 'claude'} /> {task.title}</h2>
        )}
        <IconButton icon={X} label="Close" onClick={onClose} />
      </div>

      <div className="drawer-meta">
        <span className="chip">
          <Avatar name={task.projectName} path={task.projectPath} size={14} /> {look(task.projectPath)?.name ?? task.projectName}
        </span>
        <span className="chip">{task.mode === 'headless' ? 'Headless' : 'Interactive'}</span>
        <span className="chip">{task.permission === 'bypassPermissions' ? 'Bypass checks' : task.permission}</span>
        {task.model && <span className="chip">{task.model}</span>}
        {task.budgetUsd && <span className="chip">Budget {formatCost(task.budgetUsd)}</span>}
        <label className={`chip due-edit ${dueLabel(task).tone}`} title="Due date (you get a reminder)">
          <CalendarClock size={11} />
          <input
            type="date"
            value={dueInputs(task).date}
            onChange={(e) => void window.mc.updateTask(task.id, dueFrom(e.target.value, dueInputs(task).time))}
            aria-label="Due date"
            disabled={managed}
          />
          {task.dueAt && !managed && (
            <button className="due-clear" title="Remove due date" onClick={() => void window.mc.updateTask(task.id, { dueAt: undefined, dueHasTime: undefined })}>
              ×
            </button>
          )}
        </label>
        {task.worktree && (
          <span className="chip chip-accent">
            <GitBranch size={11} /> {task.worktree.branch}
          </span>
        )}
      </div>

      <div className="drawer-actions">
        {!managed && task.column === 'todo' && (deps.kind === 'none' || deps.kind === 'ready') && (
          <Button variant="primary" icon={Play} onClick={() => onStart(task)}>
            Start
          </Button>
        )}
        {!managed && task.column === 'todo' && (deps.kind === 'waiting' || deps.kind === 'blocked') && (
          <Button icon={Play} onClick={() => onStart(task)} title="Start now without waiting for the tasks before it">
            Run anyway
          </Button>
        )}
        {!managed && task.column === 'todo' && !run && <Button icon={planning ? Loader2 : Users} disabled={planning || !prompt.trim()} onClick={() => void splitTeam()} title="Inspect the task and preview a team sized to the work. Uses the selected agent’s plan.">
          {planning ? 'Planning…' : 'Split into agents'}
        </Button>}
        {!managed && running && task.mode === 'headless' && (
          <Button icon={Square} onClick={() => onStop(task)}>
            Stop
          </Button>
        )}
        {running && task.mode === 'interactive' && run?.agentId && (
          <Button variant="primary" icon={SquareTerminal} onClick={() => onOpenAgent(run.agentId!)}>
            Open agent
          </Button>
        )}
        {!managed && !running && run?.sessionId && (
          <Button variant="primary" icon={Terminal} onClick={() => onContinue(task)} title="Open this run's chat in an agent terminal to follow up">
            Continue in terminal
          </Button>
        )}
        {!managed && !running && run && (
          <Button icon={RotateCcw} onClick={() => onStart(task)} title="Run the same prompt again">
            Run again
          </Button>
        )}
        {!task.teamParentId && task.column === 'review' && (!task.team || task.team.phase === 'review') && (
          <Button icon={CheckCircle2} onClick={() => onDone(task)}>
            Mark done
          </Button>
        )}
        <span className="spacer" />
        {!task.teamParentId && task.column !== 'done' && <IconButton icon={Link2} label="Add a task that runs after this one" onClick={() => onAddAfter(task)} />}
        {!task.teamParentId && <IconButton icon={Trash2} label="Delete task" onClick={() => onDelete(task)} disabled={running && task.mode === 'headless' || task.team?.phase === 'planning'} />}
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
            <span>
              {run.costUsd !== undefined ? formatCost(run.costUsd) : '–'}
              {run.costUsd !== undefined && <PlanShare usd={run.costUsd} prefix=" " className="muted" />}
            </span>
          </div>
        </div>
      )}

      <nav className="page-tabs drawer-tabs">
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
          Task &amp; activity
        </button>
        <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')} disabled={!canChanges} title={task.team && !canChanges ? 'Combined changes become available when integration finishes.' : task.worktree ? '' : 'Only for tasks run in a worktree'}>
          Changes
        </button>
      </nav>

      {tab === 'changes' && canChanges && task.worktree ? (
        <div className="drawer-changes">
          <ChangesPanel path={task.worktree.path} worktree={task.worktree} visible onChanged={onGitChanged} />
        </div>
      ) : (
        <div className="drawer-body scroll">
          {managed && <TaskTeamPanel task={task} all={all} onOpenTask={onOpenTask} />}
          {(before.length > 0 || after.length > 0) && (
            <section>
              <h3>
                <Link2 size={12} /> Chain
              </h3>
              <ol className="chain">
                {before.map((t) => (
                  <li key={t.id}>
                    <button className="chain-step" onClick={() => onOpenTask(t)}>
                      {statusIcon(t)}
                      <span className="ellipsis">{t.title}</span>
                      <span className="muted small">{taskFailed(t) ? 'failed, retry it to continue' : taskSucceeded(t) ? 'succeeded' : t.column === 'running' ? 'running' : 'not run yet'}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <div className="chain-step current">
                    <span className="chain-dot" />
                    <span className="ellipsis strong">{task.title}</span>
                    <span className="muted small">
                      {task.column === 'todo' ? (deps.kind === 'blocked' ? 'blocked' : deps.kind === 'waiting' ? 'waiting' : deps.kind === 'ready' ? 'ready' : 'to do') : 'this task'}
                    </span>
                  </div>
                </li>
                {after.map((t) => (
                  <li key={t.id}>
                    <button className="chain-step" onClick={() => onOpenTask(t)}>
                      {statusIcon(t)}
                      <span className="ellipsis">{t.title}</span>
                      <span className="muted small">runs after this</span>
                    </button>
                  </li>
                ))}
              </ol>
              {deps.kind === 'blocked' && <p className="field-hint warn">A task before this one failed. Open it and press Run again (or fix its checks); this one starts once it succeeds. Or press Run anyway.</p>}
            </section>
          )}

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
                <Md>{run.result}</Md>
              </div>
              {run.commit && task.worktree && (
                <p className="muted small commit-note">
                  <GitCommitHorizontal size={12} /> Changes committed as <code>{run.commit}</code> on <code>{task.worktree.branch}</code>. Review and merge them in Changes.
                </p>
              )}
            </section>
          )}

          {run?.checks && (
            <section>
              <h3>
                <ShieldCheck size={12} /> Checks
              </h3>
              <div className={`checks-box check-${run.checks.status}`}>
                <div className="checks-head">
                  {run.checks.status === 'running' ? <Loader2 size={14} className="spin" /> : run.checks.status === 'passed' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  <span className="strong">{run.checks.status === 'running' ? 'Running' : run.checks.status === 'passed' ? 'Passed' : run.checks.status === 'failed' ? 'Failed' : 'Error'}</span>
                  <code className="ellipsis">{run.checks.command}</code>
                  {run.checks.exitCode !== undefined && <span className="muted small">exit {run.checks.exitCode}</span>}
                  <span className="spacer" />
                  {!managed && !running && run.checks.status !== 'running' && (
                    <Button size="sm" variant="ghost" icon={RotateCcw} onClick={rerunChecks}>
                      Re-run checks
                    </Button>
                  )}
                </div>
                {run.checks.output.trim() && <pre className="checks-output">{run.checks.output.trim()}</pre>}
              </div>
            </section>
          )}
          {!managed && !run?.checks && run?.finishedAt && !running && !run.error && task.mode === 'headless' && (
            <p className="muted small">
              No checks ran. Set a check command (like <code>npm test</code>) in the project’s Overview tab.{' '}
              <button className="link" onClick={rerunChecks}>
                Run checks now
              </button>
            </p>
          )}

          {canFollowUp && (
            <section>
              <h3>
                <Send size={12} /> Follow up
              </h3>
              <form
                className="follow-up"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (followUp.trim()) sendFollowUp()
                }}
              >
                <textarea
                  className="prompt-input"
                  rows={3}
                  placeholder="e.g. Also add a test for the empty case."
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey && followUp.trim()) sendFollowUp()
                  }}
                />
                <div className="follow-up-foot">
                  <span className="muted small">Continues the same chat in the background{task.worktree ? ', in the same worktree' : ''}. Ctrl+Enter sends.</span>
                  <Button size="sm" variant="primary" icon={Send} type="submit" disabled={!followUp.trim()}>
                    Send
                  </Button>
                </div>
              </form>
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
