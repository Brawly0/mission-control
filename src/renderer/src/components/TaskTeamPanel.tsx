import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, CheckCircle2, Circle, GitBranch, Loader2, Pause, Play, RotateCcw, Users, XCircle } from 'lucide-react'
import type { Task, TaskTeam } from '@shared/types'
import { taskFailed, taskSucceeded } from '@shared/deps'
import { errorMessage, formatCost } from '../util'
import { useToast } from '../toast'
import { Button } from './ui'
import '../team.css'

interface Props {
  task: Task
  all: Task[]
  onOpenTask: (task: Task) => void
  onWatchAgents: (task: Task) => void
}

const PHASE_LABEL: Record<TaskTeam['phase'], string> = {
  planning: 'Planning assignments',
  ready: 'Ready to start',
  running: 'Working',
  paused: 'Paused',
  review: 'Ready for your review',
  error: 'Needs attention'
}

function memberStatus(task: Task) {
  if (task.column === 'running') return 'Running'
  if (taskSucceeded(task)) return 'Complete'
  if (taskFailed(task)) return 'Needs attention'
  return 'Waiting'
}

function MemberIcon({ task }: { task: Task }) {
  if (task.column === 'running') return <Loader2 size={14} className="spin" />
  if (taskSucceeded(task)) return <CheckCircle2 size={14} />
  if (taskFailed(task)) return <XCircle size={14} />
  return <Circle size={14} />
}

/** The original task remains the team's home; child runs link back to it. */
export default function TaskTeamPanel({ task, all, onOpenTask, onWatchAgents }: Props) {
  const root = task.teamParentId ? all.find(t => t.id === task.teamParentId) : task
  const team = root?.team
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [budget, setBudget] = useState('')
  const requestGeneration = useRef(0)

  useEffect(() => {
    requestGeneration.current++
    setBusy(false)
    setError('')
    return () => { requestGeneration.current++ }
  }, [root?.id])
  useEffect(() => { setBudget(root?.team?.budgetUsd === undefined ? '' : String(root.team.budgetUsd)) }, [root?.id, root?.team?.budgetUsd])

  if (!root || !team) return null

  const members = team.memberIds.map(id => all.find(t => t.id === id)).filter((t): t is Task => !!t)
  const planner = all.find(t => t.id === team.plannerId)
  const complete = members.filter(taskSucceeded).length
  const expected = team.memberIds.length || ((team.plan?.agents.length ?? 0) + (team.plan ? 1 : 0))
  const costs = all.filter(t => t.teamParentId === root.id).flatMap(t => t.run?.costUsd !== undefined || t.teamSpentUsd ? [(t.run?.costUsd ?? 0) + (t.teamSpentUsd ?? 0)] : [])
  const isChild = root.id !== task.id
  const active = team.phase === 'planning' || team.phase === 'running'
  const canStart = !!team.plan && !team.memberIds.length && (team.phase === 'ready' || team.phase === 'paused' || team.phase === 'error')
  const canResume = team.memberIds.length > 0 && (team.phase === 'paused' || team.phase === 'error')
  const canReplan = !team.memberIds.length && !team.plan && (team.phase === 'error' || team.phase === 'paused')

  const act = async (action: 'start' | 'stop' | 'plan') => {
    const generation = requestGeneration.current
    setBusy(true)
    setError('')
    try {
      if (action === 'start') {
        await window.mc.startTaskTeam(root.id)
        if (generation === requestGeneration.current) onWatchAgents(root)
      }
      else if (action === 'stop') await window.mc.stopTaskTeam(root.id)
      else await window.mc.planTaskTeam(root.id, team.mode)
    } catch (e) {
      const message = errorMessage(e)
      if (generation === requestGeneration.current) {
        setError(message)
        toast('error', 'Could not update the agent team', message)
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(false)
    }
  }

  const saveBudget = async () => {
    setBusy(true)
    try {
      const value = budget.trim() ? Number(budget) : undefined
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error('Enter a positive USD cap, or leave it empty for no cap.')
      await window.mc.updateTask(root.id, { budgetUsd: value })
      setError('')
    } catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className={`team-panel team-phase-${team.phase}`} aria-label="Agent team">
      <div className="team-panel-heading">
        <h3><Users size={15} /> Agent team</h3>
        <span className="team-phase" role="status">{active && <Loader2 size={12} className="spin" />}{PHASE_LABEL[team.phase]}</span>
      </div>
      <Button size="sm" icon={Users} onClick={() => onWatchAgents(root)}>{team.mode === 'interactive' ? 'View all CLI agents' : 'Watch agents'}</Button>
      {team.mode === 'interactive' && <p className="team-description">Workers and final integration use real CLI terminals. Type directly into any running pane. When its reply is complete, use Finish assignment to close that CLI and release the next agents. Planning output is read-only. Live CLI teams do not enforce USD caps.</p>}

      {isChild && <button className="team-parent-link" onClick={() => onOpenTask(root)}><ArrowUpRight size={13} /> <span>Back to {root.title}</span></button>}

      {team.phase === 'planning' && <p className="team-description">Inspecting the project and choosing the smallest useful team. You can review every assignment before the agents start.</p>}
      {team.plan && <>
        <div className="team-plan-meta"><span className="chip">{team.plan.size} task</span><span>{team.plan.agents.length} worker{team.plan.agents.length === 1 ? '' : 's'} + final integration</span></div>
        <p className="team-description">{team.plan.summary}</p>
      </>}

      {(active || canStart || canResume || canReplan) && <div className="team-panel-actions">
        {canStart && <Button size="sm" variant="primary" icon={busy ? Loader2 : Play} disabled={busy} onClick={() => void act('start')}>Start {team.plan!.agents.length} agent{team.plan!.agents.length === 1 ? '' : 's'}</Button>}
        {canResume && <Button size="sm" variant="primary" icon={busy ? Loader2 : Play} disabled={busy} onClick={() => void act('start')}>Resume team</Button>}
        {canReplan && <Button size="sm" icon={busy ? Loader2 : RotateCcw} disabled={busy} onClick={() => void act('plan')}>Retry planning</Button>}
        {active && <Button size="sm" icon={busy ? Loader2 : Pause} disabled={busy} onClick={() => void act('stop')}>{team.phase === 'planning' ? 'Stop planning' : 'Pause team'}</Button>}
      </div>}

      {expected > 0 && team.memberIds.length > 0 && <div className="team-progress">
        <div className="team-progress-label"><span>{complete} of {expected} assignments complete</span>{costs.length > 0 && <span title="Reported Claude costs, including planning. Codex costs are not available.">{formatCost(costs.reduce((sum, cost) => sum + cost, 0))} reported</span>}</div>
        <progress value={complete} max={expected} aria-label="Completed team assignments" />
      </div>}

      {(error || team.error || team.holdReason) && <div className="team-notice" role="alert"><AlertCircle size={15} /><span>{error || team.error || team.holdReason}</span></div>}

      {team.plan && !team.memberIds.length && <ol className="team-assignments">
        {team.plan.agents.map((assignment, index) => <li key={assignment.id}>
          <details className="team-assignment">
            <summary><span className="team-member-number">{index + 1}</span><span>{assignment.title}</span></summary>
            <div className="team-assignment-detail">
              <div className="team-scope"><strong>Owns</strong><span>{assignment.files.map(file => <code key={file}>{file}</code>)}</span></div>
              <p className="team-dependencies">{assignment.dependsOn.length ? `Runs after: ${assignment.dependsOn.map(id => team.plan!.agents.find(a => a.id === id)?.title ?? id).join(', ')}` : 'Can start independently when its files are free.'}</p>
              <p className="team-assignment-prompt">{assignment.prompt}</p>
            </div>
          </details>
        </li>)}
        <li className="team-integration-preview"><CheckCircle2 size={15} /><div><strong>Final integration</strong><p>Runs after every worker succeeds. Integrates the result, then runs the configured project checks.</p></div></li>
      </ol>}

      {members.length > 0 && <ol className="team-members">
        {members.map((member, index) => <li key={member.id}>
          <button className={`team-member team-member-${memberStatus(member).toLowerCase().replace(/ /g, '-')}`} onClick={() => onOpenTask(member)} aria-label={`Open ${member.title}, ${memberStatus(member)}`}>
            <span className="team-member-number">{index + 1}</span><MemberIcon task={member} />
            <span className="team-member-text"><strong>{member.teamRole === 'integrator' ? 'Final integration' : member.title}</strong><span>{member.run?.error || (member.column === 'running' ? member.run?.activity || 'Working' : memberStatus(member))}</span></span>
            <ArrowUpRight size={13} />
          </button>
        </li>)}
      </ol>}

      {planner && <button className="team-planner-link" onClick={() => onOpenTask(planner)}><ArrowUpRight size={12} />{planner.column === 'running' ? 'View planner activity' : 'View planning run'}</button>}

      {team.plan && <p className="team-workspace-note"><GitBranch size={13} /><span>One isolated worktree. Up to 3 workers run together; shared files and dependencies are coordinated.{root.worktree && <> Branch <code>{root.worktree.branch}</code>.</>}</span></p>}
      {root.tool !== 'codex' && team.mode !== 'interactive' && <div className="team-budget">
        <label>Total team cap (USD)<input className="text-input" type="number" min="0.01" step="0.01" placeholder="No cap" aria-label="Total team cap in USD" value={budget} disabled={active || busy || team.phase === 'review'} onChange={e => setBudget(e.target.value)} /></label>
        {!active && team.phase !== 'review' && <Button size="sm" disabled={busy || budget === (team.budgetUsd === undefined ? '' : String(team.budgetUsd))} onClick={() => void saveBudget()}>Save cap</Button>}
        <p className="field-hint">Includes planning, every agent, and retries. The remaining cap is shared across unfinished assignments.</p>
      </div>}
      {team.phase === 'review' && <p className="team-description">The team has finished. Review its combined changes in Changes before merging.</p>}

    </section>
  )
}
