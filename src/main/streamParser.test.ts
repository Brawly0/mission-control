import { describe, expect, it } from 'vitest'
import { applyStreamEvent, describeTool, MAX_EVENTS, addEvent } from './streamParser'
import type { TaskRun } from '../shared/types'

const newRun = (): TaskRun => ({ startedAt: 0, toolCalls: 0, events: [] })

// Shapes recorded from a real `claude -p --output-format stream-json --verbose` run.
const init = { type: 'system', subtype: 'init', session_id: 'S1', model: 'claude-haiku-4-5', permissionMode: 'acceptEdits' }
const toolUse = {
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'C:\\repo\\NOTES.md', content: 'hi' } }] }
}
const toolResult = { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }
const text = { type: 'assistant', message: { content: [{ type: 'text', text: 'Done. NOTES.md created.' }] } }
const result = { type: 'result', subtype: 'success', is_error: false, result: 'Done. NOTES.md created.', total_cost_usd: 0.0248, num_turns: 2, session_id: 'S1' }
const rate = {
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed_warning', unifiedWindows: { five_hour: { utilization: 0.94, resetsAt: 1792499400 }, seven_day: { utilization: 0.6, resetsAt: 1792731600 } } }
}

describe('applyStreamEvent', () => {
  it('follows a whole successful run', () => {
    const run = newRun()
    expect(applyStreamEvent(run, init, 'auto').final).toBe(false)
    expect(run.sessionId).toBe('S1')
    applyStreamEvent(run, toolUse, 'auto')
    expect(run.toolCalls).toBe(1)
    expect(run.activity).toBe('Writing NOTES.md')
    applyStreamEvent(run, toolResult, 'auto')
    expect(run.activity).toBe('Thinking…')
    applyStreamEvent(run, text, 'auto')
    expect(applyStreamEvent(run, result, 'auto').final).toBe(true)
    expect(run.result).toBe('Done. NOTES.md created.')
    expect(run.costUsd).toBeCloseTo(0.0248)
    expect(run.turns).toBe(2)
    expect(run.error).toBeUndefined()
    // The final text and the result are the same message: listed once, as the result.
    expect(run.events.map((e) => e.kind)).toEqual(['info', 'tool', 'result'])
  })

  it('records an error result', () => {
    const run = newRun()
    applyStreamEvent(run, { type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.2 }, 'auto')
    expect(run.error).toBe('Ended: error_max_budget_usd')
    expect(run.result).toBeUndefined()
  })

  it('adds a follow-up cost to what the run already spent', () => {
    const run = { ...newRun(), costBefore: 0.5 }
    applyStreamEvent(run, result, 'auto')
    expect(run.costUsd).toBeCloseTo(0.5248)
  })

  it('reports plan rate limits in milliseconds', () => {
    const out = applyStreamEvent(newRun(), rate, 'auto', 123)
    expect(out.rateLimit?.windows).toEqual([
      { name: 'five_hour', utilization: 0.94, resetsAt: 1792499400000 },
      { name: 'seven_day', utilization: 0.6, resetsAt: 1792731600000 }
    ])
  })

  it('ignores unknown and malformed events', () => {
    const run = newRun()
    expect(applyStreamEvent(run, { type: 'system', subtype: 'thinking_tokens' }, 'auto').final).toBe(false)
    expect(applyStreamEvent(run, null, 'auto').final).toBe(false)
    expect(run.events).toHaveLength(0)
  })
})

describe('describeTool', () => {
  it('describes common tools', () => {
    expect(describeTool('Edit', { file_path: '/a/b/app.ts' })).toBe('Editing app.ts')
    expect(describeTool('Bash', { command: 'npm test\nnpm run lint' })).toBe('Running: npm test')
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('Searching TODO')
    expect(describeTool('SomethingNew', {})).toBe('Using SomethingNew')
  })
})

describe('addEvent', () => {
  it('keeps only the newest events', () => {
    const run = newRun()
    for (let i = 0; i < MAX_EVENTS + 5; i++) addEvent(run, 'info', String(i))
    expect(run.events).toHaveLength(MAX_EVENTS)
    expect(run.events[0].text).toBe('5')
  })
})
