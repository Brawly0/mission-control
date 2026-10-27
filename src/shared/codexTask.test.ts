import { expect, it } from 'vitest'
import { applyCodexTaskEvent, codexTaskArgs } from './codexTask'
import type { TaskRun } from './types'
it('keeps plan tasks read-only and preserves a resume id without shell prompt arguments', () => {
  expect(codexTaskArgs('plan', undefined, 'thread-id')).toEqual(['exec', 'resume', 'thread-id', '--json', '--skip-git-repo-check', '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"', '-'])
  expect(codexTaskArgs('auto')).not.toContain('--dangerously-bypass-approvals-and-sandbox')
})
it('captures a real Codex turn, tools and failure independently of Claude costs', () => {
  const run: TaskRun = { startedAt: 1, toolCalls: 0, events: [] }
  const add = () => {}
  applyCodexTaskEvent(run, { type: 'thread.started', thread_id: 'id' }, add)
  applyCodexTaskEvent(run, { type: 'item.started', item: { type: 'command_execution', command: 'npm test' } }, add)
  applyCodexTaskEvent(run, { type: 'item.completed', item: { type: 'agent_message', text: 'pong' } }, add)
  expect(applyCodexTaskEvent(run, { type: 'turn.completed', usage: { input_tokens: 10 } }, add)).toBe(true)
  expect(run).toMatchObject({ sessionId: 'id', result: 'pong', toolCalls: 1 })
  expect(run.costUsd).toBeUndefined()
  applyCodexTaskEvent(run, { type: 'turn.failed', error: { message: 'Rate limited' } }, add)
  expect(run.error).toBe('Rate limited')
})
