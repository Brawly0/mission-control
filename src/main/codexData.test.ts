import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./pty', () => ({ whichSync: () => null }))
let root: string
let file: string
const id = '01a17a8e-d362-78c3-a0ef-4dca388a7a26'
const old = '2026-10-01T12:00:00Z'
const recent = '2026-11-18T12:00:00Z'
const token = (timestamp: string, input: number, output: number) => ({ timestamp, type: 'event_msg', payload: {
  type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: input / 2, output_tokens: output, reasoning_output_tokens: output / 2 } }
} })
const context = (model: string) => ({ type: 'turn_context', payload: { model } })
const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'

beforeEach(() => {
  vi.resetModules()
  root = mkdtempSync(join(tmpdir(), 'mc-stats-test-'))
  vi.stubEnv('CODEX_HOME', root)
  const dir = join(root, 'sessions', '2026', '10', '01')
  mkdirSync(dir, { recursive: true })
  file = join(dir, `rollout-2026-10-01T12-00-00-${id}.jsonl`)
  writeFileSync(file, jsonl([
    { type: 'session_meta', payload: { id, timestamp: old, cwd: 'C:\\project' } },
    context('model-a'), token(old, 100, 10), token(old, 100, 10),
    context('model-b'), token(recent, 160, 30), token(recent, 160, 30)
  ]))
})
afterEach(() => {
  vi.unstubAllEnvs()
  if (!resolve(root).startsWith(resolve(tmpdir()) + '\\mc-stats-test-') && !resolve(root).startsWith(resolve(tmpdir()) + '/mc-stats-test-')) throw new Error('Unexpected test directory')
  rmSync(root, { recursive: true, force: true })
})

describe('Codex usage periods', () => {
  it('uses token timestamps and deltas, even when file modification time is outside the period', async () => {
    utimesSync(file, new Date(old), new Date(old))
    const { codexUsage } = await import('./codexData')
    const u = await codexUsage(Date.parse(recent))
    expect(u.totals).toEqual({ input: 60, cachedInput: 30, output: 20, reasoning: 10, sessions: 1 })
    expect(u.byDay).toEqual([{ day: '2026-11-18', input: 60, cachedInput: 30, output: 20, sessions: 1 }])
    expect(u.byModel).toEqual([{ model: 'model-b', input: 60, cachedInput: 30, output: 20, sessions: 1 }])
    expect((await codexUsage(Date.parse(recent) + 1)).totals.sessions).toBe(0)
  })

  it('preserves all-time totals and splits model changes without counting repeated reports or sessions twice', async () => {
    const { codexUsage } = await import('./codexData')
    const u = await codexUsage(0)
    expect(u.totals).toEqual({ input: 160, cachedInput: 80, output: 30, reasoning: 15, sessions: 1 })
    expect(u.byModel).toEqual([
      { model: 'model-a', input: 100, cachedInput: 50, output: 10, sessions: 1 },
      { model: 'model-b', input: 60, cachedInput: 30, output: 20, sessions: 1 }
    ])
    expect(u.byProject[0].sessions).toBe(1)
    appendFileSync(file, jsonl([token(recent, 180, 40)]))
    const updated = await codexUsage(Date.parse(recent))
    expect(updated.totals).toEqual({ input: 80, cachedInput: 40, output: 30, reasoning: 15, sessions: 1 })
    expect(updated.byDay[0].sessions).toBe(1)
  })
})
