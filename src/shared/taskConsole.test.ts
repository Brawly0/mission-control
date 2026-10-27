import { describe, expect, it } from 'vitest'
import { formatClaudeEvent, formatCodexEvent, formatEvents, formatStart, toolOutput } from './taskConsole'

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('task console', () => {
  it('shows Claude tool calls, their output and replies like the CLI', () => {
    const call = formatClaudeEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test\n--watch' } }] } })
    expect(plain(call)).toBe('● Bash(npm test)\r\n')
    const out = formatClaudeEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ok 1\nok 2' }] }] } })
    expect(plain(out)).toBe('  ⎿  ok 1\r\n     ok 2\r\n\r\n')
    const text = formatClaudeEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.\nAll green.' }] } })
    expect(plain(text)).toBe('● Done.\r\n  All green.\r\n\r\n')
  })

  it('collapses long tool output and marks errors', () => {
    const long = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    expect(plain(toolOutput(long))).toContain('… +4 lines')
    expect(toolOutput('boom', true)).toContain('\x1b[31m')
    expect(plain(toolOutput(''))).toContain('(no output)')
  })

  it('ends with the result and its cost, or the error', () => {
    expect(plain(formatClaudeEvent({ type: 'result', subtype: 'success', total_cost_usd: 0.0421, num_turns: 3 }))).toBe('✓ Done $0.042 · 3 turns\r\n')
    expect(plain(formatClaudeEvent({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }))).toContain('✗ Ended: error_max_budget_usd')
    expect(formatClaudeEvent({ type: 'rate_limit_event' })).toBe('')
  })

  it('shows Codex commands, file changes and messages', () => {
    expect(plain(formatCodexEvent({ type: 'item.started', item: { type: 'command_execution', command: 'git status' } }))).toBe('● Run(git status)\r\n')
    expect(plain(formatCodexEvent({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'clean', exit_code: 1 } }))).toContain('exit 1')
    expect(plain(formatCodexEvent({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.ts', kind: 'add' }] } }))).toContain('● Write(a.ts)')
    expect(plain(formatCodexEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'Finished' } }))).toContain('● Finished')
    expect(plain(formatCodexEvent({ type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 30 } }))).toBe('✓ Done 1,200 in · 30 out\r\n')
  })

  it('rebuilds a readable log from saved events', () => {
    const log = plain(formatEvents([{ at: 1, kind: 'tool', text: 'Editing app.ts' }, { at: 2, kind: 'result', text: 'All done\nmore' }]))
    expect(log).toContain('● Editing app.ts')
    expect(log).toContain('✓ All done')
    expect(formatEvents([])).toBe('')
    expect(plain(formatStart('C:\\p', 'claude -p'))).toBe('C:\\p\r\n❯ claude -p\r\n\r\n')
  })
})
