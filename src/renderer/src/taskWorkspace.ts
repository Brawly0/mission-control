import type { Task } from '../../shared/types'
import { dependencyState, taskFailed, taskSucceeded } from '../../shared/deps'

export interface TaskWorkspace { root: Task; agents: Task[] }

/** A team is one workspace, including queued members and saved runs from before this launch. */
export function taskWorkspaces(tasks: Task[], projectFilter: string): TaskWorkspace[] {
  return tasks.filter(t => !t.teamParentId && (t.team || t.run))
    .filter(t => !projectFilter || t.projectPath.toLowerCase() === projectFilter.toLowerCase())
    .map(root => ({ root, agents: root.team
      ? [root.team.plannerId, ...root.team.memberIds].map(id => tasks.find(t => t.id === id && t.teamParentId === root.id)).filter((t): t is Task => !!t)
      : [root] }))
}

export function workspaceAgentStatus(task: Task, all: Task[]): { label: string; tone: string; detail: string } {
  if (task.run?.checks?.status === 'running') return { label: 'Checking', tone: 'working', detail: 'Running project checks before completing the assignment.' }
  if (task.column === 'running') return { label: 'Working', tone: 'working', detail: task.run?.activity || 'Starting agent…' }
  if (taskSucceeded(task)) return { label: 'Finished', tone: 'done', detail: 'Assignment complete' }
  if (taskFailed(task)) return { label: 'Needs attention', tone: 'error', detail: task.run?.error || task.run?.checks?.output || 'Verification failed' }
  const parent = all.find(t => t.id === task.teamParentId)
  if (parent?.team?.phase === 'paused' || parent?.team?.phase === 'error') return { label: 'Paused', tone: 'waiting', detail: parent.team.error || 'Resume the team from its task controls.' }
  const deps = dependencyState(task, all)
  return { label: deps.kind === 'blocked' ? 'Blocked' : 'Waiting', tone: deps.kind === 'blocked' ? 'error' : 'waiting', detail: deps.kind === 'blocked'
    ? `Waiting for recovery: ${deps.failed.map(t => t.title).join(', ')}`
    : deps.waitingOn.length ? `Runs after: ${deps.waitingOn.map(t => t.title).join(', ')}` : 'Waiting for the coordinator to start this agent.' }
}
