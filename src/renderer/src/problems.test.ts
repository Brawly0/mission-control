import { describe, expect, it } from 'vitest'
import type { ReadinessOutcome, ReadinessResult } from '../../shared/readiness'
import type { ProjectReview, Task } from '../../shared/types'
import { deriveProblems, visibleProblems, type ProblemState } from './problems'

const result = (outcome: ReadinessOutcome, at: number): ReadinessResult => ({ requestId: `r${at}`, startedAt: at, completedAt: at + 1, outcome, suggestions: [], checks: [{ id: 'claude.authentication', outcome, reason: outcome === 'ready' ? 'verified' : 'signed_out', action: 'setup', explanation: 'secret diagnostic text', checkedAt: at + 1 }] })
const diagnostic = (previous: ProblemState, outcome: ReadinessOutcome, at: number, latestRequestId = `r${at}`) => deriveProblems(previous, { diagnostics: [{ scope: { kind: 'connections' }, latestRequestId, result: result(outcome, at) }] })
const task = (patch: Partial<Task> = {}): Task => ({ id: 'task', title: 'secret title', prompt: 'secret prompt', projectPath: '/a', projectName: 'A', column: 'review', mode: 'headless', permission: 'plan', useWorktree: false, createdAt: 1, updatedAt: 10, order: 0, run: { startedAt: 2, finishedAt: 9, toolCalls: 0, events: [], error: 'secret token' }, ...patch })
const tasks = (previous: ProblemState, t: Task) => deriveProblems(previous, { tasks: [t] })

describe('authoritative problem reconciliation', () => {
  it('deduplicates refreshes and uses only safe summaries', () => {
    let state = diagnostic({}, 'missing', 10)
    state = diagnostic(state, 'missing', 20)
    expect(visibleProblems(state)).toHaveLength(1)
    expect(JSON.stringify(state)).not.toContain('secret')
    expect(visibleProblems(state)[0].action.kind).toBe('setup')
    expect(visibleProblems(state)[0].secondary?.kind).toBe('recheck')
  })
  it('ignores pending, cancelled, superseded and wrong request results', () => {
    const state = diagnostic({}, 'missing', 10)
    for (const outcome of ['checking', 'cancelled', 'stale'] as const) expect(diagnostic(state, outcome, 20)).toEqual(state)
    expect(diagnostic(state, 'ready', 20, 'newer-request')).toEqual(state)
    expect(deriveProblems(state, {})).toEqual(state)
  })
  it('retains uncertainty through failed refreshes and requires newer verification', () => {
    let state = diagnostic({}, 'missing', 10)
    state = diagnostic(state, 'unavailable', 20)
    expect(visibleProblems(state)).toHaveLength(1)
    expect(visibleProblems(diagnostic(state, 'ready', 10))).toHaveLength(1)
    state = diagnostic(state, 'ready', 30)
    expect(visibleProblems(state)).toHaveLength(0)
    expect(visibleProblems(diagnostic(state, 'missing', 20))).toHaveLength(0)
    expect(visibleProblems(diagnostic(state, 'missing', 40))).toHaveLength(1)
  })
  it('does not resolve a missing check or a different scope', () => {
    const state = diagnostic({}, 'missing', 10)
    const fresh = result('ready', 20)
    expect(visibleProblems(deriveProblems(state, { diagnostics: [{ scope: { kind: 'connections' }, latestRequestId: fresh.requestId, result: { ...fresh, checks: [] } }] }))).toHaveLength(1)
    expect(visibleProblems(deriveProblems(state, { diagnostics: [{ scope: { kind: 'project', projectPath: '/a' }, latestRequestId: fresh.requestId, result: fresh }] }))).toHaveLength(1)
  })
  it('resolves a verified check even when another requirement remains unavailable', () => {
    const state = diagnostic({}, 'missing', 10)
    const fresh = result('ready', 20)
    const mixed: ReadinessResult = { ...fresh, outcome: 'unavailable', checks: [...fresh.checks, { ...fresh.checks[0], id: 'codex.authentication', outcome: 'unavailable', reason: 'offline', action: 'recheck' }] }
    const remaining = visibleProblems(deriveProblems(state, { diagnostics: [{ scope: { kind: 'connections' }, latestRequestId: fresh.requestId, result: mixed }] }))
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toContain('codex.authentication')
  })
  it('keeps run failures during retries and resolves only the relevant successful task', () => {
    const state = tasks({}, task())
    expect(JSON.stringify(state)).not.toContain('secret')
    expect(visibleProblems(tasks(state, task({ column: 'running', updatedAt: 20, run: { startedAt: 20, toolCalls: 0, events: [] } })))).toHaveLength(1)
    expect(visibleProblems(tasks(state, task({ id: 'other', updatedAt: 30, run: { startedAt: 20, finishedAt: 29, toolCalls: 0, events: [] } })))).toHaveLength(1)
    const success = task({ updatedAt: 30, run: { startedAt: 20, finishedAt: 29, toolCalls: 0, events: [] } })
    const resolved = tasks(state, success)
    expect(visibleProblems(resolved)).toHaveLength(0)
    expect(visibleProblems(tasks(resolved, task()))).toHaveLength(0)
    expect(visibleProblems(tasks(resolved, task({ updatedAt: 40 })))).toHaveLength(1)
  })
  it('does not resolve failed checks through missing, pending, error or old checks', () => {
    const base = task({ run: { startedAt: 2, finishedAt: 9, toolCalls: 0, events: [], checks: { command: 'test', status: 'failed', output: 'secret output', startedAt: 9, finishedAt: 10 } } })
    const state = tasks({}, base)
    for (const status of ['running', 'error'] as const) expect(visibleProblems(tasks(state, { ...base, updatedAt: 20, run: { ...base.run!, checks: { ...base.run!.checks!, status } } }))).toHaveLength(1)
    expect(visibleProblems(tasks(state, { ...base, updatedAt: 20, run: { ...base.run!, checks: undefined } }))).toHaveLength(1)
    expect(visibleProblems(tasks(state, { ...base, updatedAt: 20, run: { ...base.run!, checks: { ...base.run!.checks!, status: 'passed', startedAt: 1 } } }))).toHaveLength(1)
    expect(visibleProblems(tasks(state, { ...base, updatedAt: 30, run: { ...base.run!, checks: { ...base.run!.checks!, status: 'passed', finishedAt: 30 } } }))).toHaveLength(0)
  })
  it('records interrupted runs but never offers direct retries for team members', () => {
    const problems = visibleProblems(tasks({}, task({ teamParentId: 'root', run: { startedAt: 2, toolCalls: 0, events: [] } })))
    expect(problems).toHaveLength(1)
    expect(problems[0].secondary).toBeUndefined()
  })
  it('preserves review failures through stale, stopped, and pending checks', () => {
    const review: ProjectReview = {
      projectPath: '/a', fingerprint: 'diff', checkCommand: 'test', checkStale: false, reviewStale: false,
      changes: {} as ProjectReview['changes'],
      check: { id: 'check', commandId: 'check', projectPath: '/a', name: 'Check', command: 'test', state: 'failed', startedAt: 10, finishedAt: 20, output: 'secret output' }
    }
    const state = deriveProblems({}, { reviews: [review] })
    expect(visibleProblems(state)).toHaveLength(1)
    expect(JSON.stringify(state)).not.toContain('secret')
    for (const status of ['running', 'stopping', 'stopped'] as const) expect(visibleProblems(deriveProblems(state, { reviews: [{ ...review, check: { ...review.check!, state: status, startedAt: 30, finishedAt: status === 'stopped' ? 40 : undefined } }] }))).toHaveLength(1)
    const passed = { ...review, check: { ...review.check!, state: 'passed' as const, startedAt: 30, finishedAt: 40 } }
    expect(visibleProblems(deriveProblems(state, { reviews: [{ ...passed, checkStale: true }] }))).toHaveLength(1)
    const resolved = deriveProblems(state, { reviews: [passed] })
    expect(visibleProblems(resolved)).toHaveLength(0)
    expect(visibleProblems(deriveProblems(resolved, { reviews: [review] }))).toHaveLength(0)
    expect(visibleProblems(deriveProblems(resolved, { reviews: [{ ...review, check: { ...review.check!, startedAt: 50, finishedAt: 60 } }] }))).toHaveLength(1)
  })
})
