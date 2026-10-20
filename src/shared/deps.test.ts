import { describe, expect, it } from 'vitest'
import { chainBaseFor, dependencyState, dependentsOf, taskFailed, taskSucceeded, wouldCreateCycle } from './deps'
import type { Task, TaskColumn, TaskRun } from './types'

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    prompt: '',
    projectPath: 'C:\\p',
    projectName: 'p',
    column: 'todo',
    mode: 'headless',
    permission: 'auto',
    useWorktree: false,
    createdAt: 0,
    updatedAt: 0,
    order: 0,
    ...patch
  }
}
const run = (patch: Partial<TaskRun> = {}): TaskRun => ({ startedAt: 1, finishedAt: 2, toolCalls: 0, events: [], ...patch })
const done = (id: string, column: TaskColumn = 'review', patch: Partial<TaskRun> = {}) => task(id, { column, run: run(patch) })

describe('taskSucceeded / taskFailed', () => {
  it('a finished run without error succeeded', () => {
    expect(taskSucceeded(done('a'))).toBe(true)
    expect(taskSucceeded(done('a', 'done'))).toBe(true)
  })
  it('an error means failed', () => {
    expect(taskFailed(done('a', 'review', { error: 'boom' }))).toBe(true)
  })
  it('failed checks mean failed; running checks mean not finished yet', () => {
    const cmd = { command: 'npm test', output: '', startedAt: 1 }
    expect(taskFailed(done('a', 'review', { checks: { ...cmd, status: 'failed' } }))).toBe(true)
    const pending = done('a', 'review', { checks: { ...cmd, status: 'running' } })
    expect(taskSucceeded(pending)).toBe(false)
    expect(taskFailed(pending)).toBe(false)
  })
  it('a running or never-run task is neither', () => {
    expect(taskSucceeded(task('a', { column: 'running', run: run({ finishedAt: undefined }) }))).toBe(false)
    expect(taskFailed(task('a'))).toBe(false)
  })
})

describe('dependencyState', () => {
  it('no dependencies', () => {
    expect(dependencyState(task('b'), []).kind).toBe('none')
  })
  it('waiting while a dependency has not finished', () => {
    const a = task('a', { column: 'running', run: run({ finishedAt: undefined }) })
    const s = dependencyState(task('b', { dependsOn: ['a'] }), [a])
    expect(s.kind).toBe('waiting')
    expect(s.waitingOn.map((t) => t.id)).toEqual(['a'])
  })
  it('blocked when a dependency failed, even if others are pending', () => {
    const all = [done('a', 'review', { error: 'x' }), task('c')]
    const s = dependencyState(task('b', { dependsOn: ['a', 'c'] }), all)
    expect(s.kind).toBe('blocked')
    expect(s.failed.map((t) => t.id)).toEqual(['a'])
  })
  it('ready when all dependencies succeeded', () => {
    expect(dependencyState(task('c', { dependsOn: ['a', 'b'] }), [done('a'), done('b', 'done')]).kind).toBe('ready')
  })
  it('ignores deleted dependencies', () => {
    expect(dependencyState(task('b', { dependsOn: ['gone'] }), []).kind).toBe('none')
  })
})

describe('dependentsOf / wouldCreateCycle', () => {
  const all = [task('a'), task('b', { dependsOn: ['a'] }), task('c', { dependsOn: ['b'] })]
  it('finds direct dependents', () => {
    expect(dependentsOf('a', all).map((t) => t.id)).toEqual(['b'])
  })
  it('detects a loop through the chain', () => {
    expect(wouldCreateCycle('a', ['c'], all)).toBe(true)
    expect(wouldCreateCycle('a', ['a'], all)).toBe(true)
  })
  it('allows a new task after the end of the chain', () => {
    expect(wouldCreateCycle('d', ['c'], all)).toBe(false)
  })
})

describe('chainBaseFor', () => {
  const wt = (branch: string) => ({ path: `C:\\wt\\${branch}`, branch, base: 'main', repoRoot: 'C:\\p' })
  it('picks the most recently finished successful worktree dependency', () => {
    const a = task('a', { column: 'review', worktree: wt('mc/a'), run: run({ finishedAt: 10 }) })
    const b = task('b', { column: 'review', worktree: wt('mc/b'), run: run({ finishedAt: 20 }) })
    const fail = task('f', { column: 'review', worktree: wt('mc/f'), run: run({ finishedAt: 30, error: 'x' }) })
    expect(chainBaseFor(task('c', { dependsOn: ['a', 'b', 'f'] }), [a, b, fail])?.id).toBe('b')
  })
  it('none when no dependency ran in a worktree', () => {
    expect(chainBaseFor(task('c', { dependsOn: ['a'] }), [done('a')])).toBeUndefined()
  })
})
