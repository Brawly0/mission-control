import { describe, expect, it } from 'vitest'
import type { Task } from '../../shared/types'
import { taskWorkspaces, workspaceAgentStatus } from './taskWorkspace'

const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, title: id, prompt: '', projectPath: 'C:\\Project', projectName: 'Project', column: 'todo', mode: 'headless', permission: 'auto', useWorktree: false, createdAt: 0, updatedAt: 0, order: 0, ...patch })
const run = { startedAt: 1, finishedAt: 2, toolCalls: 0, events: [] }

describe('task agent workspaces', () => {
  it('keeps saved planner output, queued workers and integration in one ordered workspace', () => {
    const root = task('team', { team: { phase: 'running', plannerId: 'plan', memberIds: ['worker', 'integrate'] } })
    const plan = task('plan', { teamParentId: 'team', teamRole: 'planner', column: 'review', run })
    const worker = task('worker', { teamParentId: 'team', teamRole: 'worker' })
    const integrate = task('integrate', { teamParentId: 'team', teamRole: 'integrator' })
    expect(taskWorkspaces([integrate, root, worker, plan], '')).toEqual([{ root, agents: [plan, worker, integrate] }])
  })
  it('filters entire teams by project, tolerates deleted members and rejects foreign members', () => {
    const root = task('team', { team: { phase: 'paused', plannerId: 'missing', memberIds: ['foreign'] } })
    const foreign = task('foreign', { teamParentId: 'other' })
    expect(taskWorkspaces([root, foreign], 'c:\\project')).toEqual([{ root, agents: [] }])
    expect(taskWorkspaces([root], 'C:\\Other')).toEqual([])
  })
  it('retains old standalone output while excluding tasks that have never run', () => {
    const old = task('old', { column: 'review', run })
    expect(taskWorkspaces([task('new'), old], '')).toEqual([{ root: old, agents: [old] }])
  })
  it('shows blocked dependencies and paused teams without inventing a running agent', () => {
    const failed = task('failed', { column: 'review', run: { ...run, error: 'Failure' } })
    const waiting = task('waiting', { dependsOn: ['failed'] })
    expect(workspaceAgentStatus(waiting, [failed]).label).toBe('Blocked')
    const root = task('team', { team: { phase: 'paused', plannerId: 'p', memberIds: ['waiting'] } })
    expect(workspaceAgentStatus({ ...waiting, teamParentId: 'team' }, [root]).label).toBe('Paused')
  })
  it('reports actual activity, dependency names, successful completion and pending checks', () => {
    expect(workspaceAgentStatus(task('busy', { column: 'running', run: { ...run, activity: 'Editing UI' } }), []).detail).toBe('Editing UI')
    expect(workspaceAgentStatus(task('waiting', { dependsOn: ['first'] }), [task('first')]).detail).toContain('first')
    expect(workspaceAgentStatus(task('done', { column: 'review', run }), []).label).toBe('Finished')
    expect(workspaceAgentStatus(task('checking', { column: 'review', run: { ...run, checks: { command: 'test', startedAt: 1, output: '', status: 'running' } } }), []).label).toBe('Checking')
  })
})
