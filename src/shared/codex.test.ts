import { describe, expect, it } from 'vitest'
import { codexCommand, codexFileChanges, codexIdFromFile, codexLimits, codexPrompt, codexRecapBuilder, codexStates, codexTotals } from './codex'

// Shapes copied from real Codex 0.164 rollouts.
const T = (min: number) => new Date(Date.UTC(2026, 9, 27, 10, min)).toISOString()
const msg = (role: string, text: string, min: number) => ({
  timestamp: T(min),
  type: 'response_item',
  payload: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] }
})
const ev = (payload: object, min: number) => ({ timestamp: T(min), type: 'event_msg', payload })
const cmd = (command: string, min: number) =>
  ev({ type: 'item_completed', item: { type: 'CommandExecution', command: ['powershell.exe', '-Command', command], parsed_cmd: [{ type: 'unknown', cmd: command }] } }, min)
const patch = (body: string, min: number) => ({ timestamp: T(min), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: `text(await tools.apply_patch(${JSON.stringify(body)}))` } })

describe('codex rollouts', () => {
  it('reads the session id from a file name', () => {
    expect(codexIdFromFile('rollout-2026-10-27T01-32-23-01a17a8e-d362-78c3-a0ef-4dca388a7a26.jsonl')).toBe('01a17a8e-d362-78c3-a0ef-4dca388a7a26')
    expect(codexIdFromFile('notes.jsonl')).toBeNull()
  })

  it('keeps only prompts you typed', () => {
    expect(codexPrompt(msg('user', 'fix the header', 0))).toBe('fix the header')
    expect(codexPrompt(msg('user', '<environment_context>\n  <cwd>C:\\app</cwd>', 0))).toBe('')
    expect(codexPrompt(msg('developer', 'You are Codex', 0))).toBe('')
    expect(codexPrompt(msg('assistant', 'ok', 0))).toBe('')
  })

  it('reads commands and patched files', () => {
    expect(codexCommand(cmd('npm test', 0))).toBe('npm test')
    expect(codexFileChanges(patch('*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: src/b.ts\n+x\n*** End Patch', 0))).toEqual([
      { path: 'src/a.ts', created: false },
      { path: 'src/b.ts', created: true }
    ])
    expect(codexFileChanges(ev({ type: 'item_completed', item: { type: 'FileChange', changes: { 'C:\\app\\c.ts': { type: 'update' } } } }, 0))).toEqual([{ path: 'C:\\app\\c.ts', created: false }])
  })

  it('builds the same recap as a Claude chat', () => {
    const b = codexRecapBuilder('s1')
    const entries = [
      { timestamp: T(0), type: 'session_meta', payload: { id: 's1', cwd: 'C:\\app' } },
      msg('user', '<environment_context>…', 0),
      ev({ type: 'task_started' }, 0),
      msg('user', 'add a dark mode', 1),
      msg('assistant', 'Adding it.', 2),
      patch('*** Update File: C:\\app\\src\\theme.ts\n', 3),
      patch('*** Update File: C:\\app\\src\\theme.ts\n*** Add File: C:\\app\\src\\dark.css\n', 4),
      cmd('git add -A; git commit -m "feat: dark mode"', 5),
      msg('assistant', 'Done: dark mode is in.', 6),
      ev({ type: 'task_complete' }, 6),
      msg('user', 'thanks', 60)
    ]
    entries.forEach((e) => b.add(e))
    const r = b.done()
    expect(r.prompts).toBe(2)
    expect(r.firstPrompts.map((p) => p.text)).toEqual(['add a dark mode', 'thanks'])
    expect(r.files).toEqual([
      { path: 'src\\theme.ts', edits: 2, created: false },
      { path: 'src\\dark.css', edits: 1, created: true }
    ])
    expect(r.commands).toBe(1)
    expect(r.commits).toEqual(['feat: dark mode'])
    expect(r.lastReply).toBe('Adding it.\n\nDone: dark mode is in.')
    // The 54-minute gap is a break.
    expect(r.activeMinutes).toBe(6)
  })

  it('reads token totals and plan limits from token_count', () => {
    const e = ev(
      {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 440654, cached_input_tokens: 397952, output_tokens: 1618, reasoning_output_tokens: 0 } },
        rate_limits: {
          primary: { used_percent: 7, window_minutes: 300, resets_at: 1793075503 },
          secondary: { used_percent: 1, window_minutes: 10080, resets_at: 1793662303 },
          plan_type: 'plus',
          rate_limit_reached_type: null
        }
      },
      9
    )
    expect(codexTotals(e)).toEqual({ input: 440654, cachedInput: 397952, output: 1618, reasoning: 0 })
    const limits = codexLimits(e)!
    expect(limits.plan).toBe('plus')
    expect(limits.windows).toEqual([
      { name: 'five_hour', utilization: 0.07, resetsAt: 1793075503000 },
      { name: 'seven_day', utilization: 0.01, resetsAt: 1793662303000 }
    ])
    expect(codexTotals(msg('user', 'x', 0))).toBeNull()
  })

  it('reads the state Codex reports to the terminal', () => {
    const out = 'abc\x1b]7501;state=working:app=codex\x07def\x1b]7501;state=blocked:app=codex:kind=permission\x07\x1b]0;title\x07'
    expect(codexStates(out)).toEqual([{ state: 'working', kind: undefined }, { state: 'blocked', kind: 'permission' }])
    expect(codexStates('\x1b]7501;state=idle:app=other\x07')).toEqual([])
  })
})
