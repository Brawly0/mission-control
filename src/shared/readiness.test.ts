import { describe, expect, it } from 'vitest'
import { DEFAULT_GUIDED_SETUP, readinessProblems, reconcileReadinessProblems, validateSetupPatch, validRequestId } from './readiness'
import type { ReadinessResult, ReadinessOutcome } from './readiness'
describe('readiness contracts', () => {
  it('accepts only bounded request identities', () => {
    expect(validRequestId('a-UUID_1')).toBe(true)
    for (const id of ['', '../x', 'x'.repeat(81), null, 1]) expect(validRequestId(id)).toBe(false)
  })
  it('validates additive setup choices and lifecycle actions', () => {
    for (const status of ['active', 'skipped', 'dismissed', 'complete']) expect(() => validateSetupPatch({ providers: ['claude', 'codex'], status })).not.toThrow()
    for (const patch of [null, [], { providers: [] }, { providers: ['claude', 'claude'] }, { step: 'unknown' }, { token: 'SECRET' }, { status: 'done' }]) expect(() => validateSetupPatch(patch)).toThrow()
    expect(DEFAULT_GUIDED_SETUP.status).toBe('not-started')
  })
  it('does not resolve problems on unavailable, cancelled or stale outcomes', () => {
    for (const outcome of ['missing', 'failed', 'unavailable', 'cancelled', 'stale', 'ready', 'checking'] as ReadinessOutcome[]) {
      const result = { outcome, checks: [{ id: 'claude.authentication', outcome }] } as ReadinessResult
      expect(readinessProblems(result).length).toBe(outcome === 'ready' || outcome === 'checking' ? 0 : 1)
    }
  })
  it('removes problems only after fresh verification and preserves problems absent from a partial result', () => {
    const problem = { id: 'project.git', outcome: 'missing', checkedAt: 100 } as const
    const previous = [problem] as unknown as ReadinessResult['checks']
    const snapshot = (outcome: ReadinessOutcome, checks: unknown[] = []): ReadinessResult => ({ outcome, checks }) as ReadinessResult
    expect(reconcileReadinessProblems(previous, snapshot('cancelled', [{ ...problem, outcome: 'ready', checkedAt: 200 }]))).toEqual(previous)
    expect(reconcileReadinessProblems(previous, snapshot('stale'))).toEqual(previous)
    expect(reconcileReadinessProblems(previous, snapshot('unavailable'))).toEqual(previous)
    expect(reconcileReadinessProblems(previous, snapshot('ready', [{ ...problem, outcome: 'ready', checkedAt: 99 }]))).toEqual(previous)
    expect(reconcileReadinessProblems(previous, snapshot('ready', [{ ...problem, outcome: 'ready', checkedAt: 200 }]))).toEqual([])
    const busy = [{ id: 'diagnostic', outcome: 'unavailable', checkedAt: 100 }] as ReadinessResult['checks']
    expect(reconcileReadinessProblems(busy, snapshot('ready', [{ ...problem, outcome: 'ready', checkedAt: 200 }]))).toEqual([])
  })
})
