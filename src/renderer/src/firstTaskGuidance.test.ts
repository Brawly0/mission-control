import { describe, expect, it } from 'vitest'
import type { Task } from '../../shared/types'
import { firstTaskProgress, recordTaskInspection, STARTER_TASK, type FirstTaskInput, type TaskInspection } from './firstTaskGuidance'

const task = (patch: Partial<Task> = {}): Task => ({ id: 'one', title: 'Explore', prompt: 'Inspect', projectPath: '/a', projectName: 'A', column: 'todo', mode: 'headless', permission: 'plan', useWorktree: true, createdAt: 1, updatedAt: 1, order: 0, ...patch })
const finished = task({ column: 'review', run: { startedAt: 10, finishedAt: 20, toolCalls: 1, events: [], result: 'Summary' } })
const seen: TaskInspection = { taskId: 'one', runStartedAt: 10, runFinishedAt: 20, result: true, changes: false }
const progress = (t: Task = task(), patch: Partial<FirstTaskInput> = {}) => firstTaskProgress({ projectPath: '/a', taskId: 'one', tasks: [t], ...patch }).step

describe('first task guidance from application state', () => {
  it('combines result and explicit diff review in either order, invalidating changed or unavailable snapshots', () => {
    const isolated = { ...finished, worktree: { path: '/w', repoRoot: '/a', branch: 'task', base: 'main' } }
    const diff = { ...seen, result: false, changes: true, changesFingerprint: 'diff-1' }
    for (const inspection of [recordTaskInspection(seen, diff, 'changes'), recordTaskInspection(diff, seen, 'result')]) {
      expect(progress(isolated, { inspection, reviewFingerprint: inspection.changesFingerprint })).toBe('complete')
      for (const fingerprint of ['diff-2', undefined]) {
        const refreshed = recordTaskInspection(inspection, { ...diff, changes: false, changesFingerprint: fingerprint }, 'changes')
        expect(refreshed.result).toBe(true)
        expect(progress(isolated, { inspection: refreshed, reviewFingerprint: fingerprint })).toBe('review')
      }
      expect(recordTaskInspection(inspection, { ...seen, runStartedAt: 30 }, 'result').changes).toBe(false)
      expect(recordTaskInspection(inspection, { ...diff, taskId: 'other' }, 'changes').result).toBe(false)
    }
  })
  it('requires a selected project and explicit task identity', () => {
    expect(progress(task(), { projectPath: undefined })).toBe('project')
    expect(progress(task(), { taskId: undefined })).toBe('create')
    expect(progress(task(), { projectPath: '/b' })).toBe('create')
    expect(progress(task({ id: 'other' }))).toBe('create')
    expect(progress(task({ teamParentId: 'parent' }))).toBe('create')
  })
  it('offers a draft without requiring permissions that could modify files', () => {
    expect(STARTER_TASK.permission).toBe('plan')
    expect(STARTER_TASK.prompt).toContain('without changing files or running commands')
    expect(progress()).toBe('start')
    expect(progress(task({ permission: undefined as unknown as Task['permission'] }))).toBe('choices')
  })
  it('tracks real starts, interrupted runs and failures', () => {
    expect(progress(task({ column: 'running', run: { startedAt: 10, events: [], toolCalls: 0 } }))).toBe('progress')
    expect(progress(task({ run: { startedAt: 10, events: [], toolCalls: 0 } }))).toBe('recover')
    expect(progress({ ...finished, run: { ...finished.run!, error: 'secret' } }, { inspection: seen })).toBe('recover')
  })
  it('does not use done or opening a task as inspection evidence', () => {
    expect(progress(finished)).toBe('review')
    expect(progress({ ...finished, column: 'done' })).toBe('review')
    expect(progress(finished, { inspection: seen })).toBe('complete')
  })
  it('scopes inspection to task and exact run attempt', () => {
    for (const inspection of [{ ...seen, taskId: 'other' }, { ...seen, runStartedAt: 9 }, { ...seen, runFinishedAt: 19 }]) expect(progress(finished, { inspection })).toBe('review')
    expect(progress({ ...finished, run: { ...finished.run!, startedAt: 30, finishedAt: 40 } }, { inspection: seen })).toBe('review')
  })
  it('requires actual change inspection for isolated work', () => {
    const isolated = { ...finished, worktree: { path: '/w', repoRoot: '/a', branch: 'task', base: 'main' } }
    expect(progress(isolated, { inspection: seen })).toBe('review')
    const inspection = { ...seen, changes: true, changesFingerprint: 'diff-1' }
    expect(progress(isolated, { inspection })).toBe('review')
    expect(progress(isolated, { inspection, reviewFingerprint: 'diff-2' })).toBe('review')
    expect(progress(isolated, { inspection, reviewFingerprint: 'diff-1' })).toBe('complete')
  })
  it('rejects pending, failed, incomplete and old checks', () => {
    for (const status of ['running', 'failed', 'error', 'passed'] as const) {
      const run = { ...finished.run!, checks: { command: 'test', status, startedAt: 21, output: '' } }
      expect(progress({ ...finished, run }, { inspection: seen })).toBe(status === 'running' ? 'progress' : 'recover')
    }
    expect(progress({ ...finished, run: { ...finished.run!, checks: { command: 'test', status: 'passed', startedAt: 1, finishedAt: 2, output: '' } } }, { inspection: seen })).toBe('recover')
  })
  it('does not equate team planning with a completed task', () => {
    expect(progress(task({ team: { phase: 'planning', plannerId: 'planner', memberIds: [] } }))).toBe('progress')
    expect(progress(task({ team: { phase: 'error', plannerId: 'planner', memberIds: [] } }))).toBe('recover')
    expect(progress(task({ team: { phase: 'paused', plannerId: 'planner', memberIds: [] } }))).toBe('recover')
    expect(progress(task({ team: { phase: 'ready', plannerId: 'planner', memberIds: [] } }))).toBe('start')
  })
})
