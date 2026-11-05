import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HookEvent, Task } from '../shared/types'

const mock = vi.hoisted(() => ({ launch: vi.fn(), kill: vi.fn(), file: vi.fn(), codexFile: vi.fn(), dir: '', hooks: new Set<(event: HookEvent) => void>(), taps: new Set<{ exit?: (id: string, code: number) => void }>() }))
vi.mock('electron', () => ({ app: { getPath: () => mock.dir } }))
vi.mock('./terminals', () => ({ launchTerminal: mock.launch, hookTaps: mock.hooks, ptyTaps: mock.taps }))
vi.mock('./pty', () => ({ killTerminal: mock.kill }))
vi.mock('./spend', () => ({ findSessionFile: mock.file }))
vi.mock('./codexData', () => ({ codexFileFor: mock.codexFile }))
import { startTaskCli, taskCliResult, taskCliState } from './taskCli'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'mc-cli-test-')); dirs.push(dir); return dir }
const task = (tool: 'claude' | 'codex' = 'claude'): Task => ({ id: 'assignment-id', title: 'Implement UI', prompt: '', projectPath: 'C:\\project', projectName: 'Project', column: 'running', mode: 'interactive', permission: 'auto', useWorktree: false, tool, createdAt: 0, updatedAt: 0, order: 0, run: { startedAt: 1, events: [], toolCalls: 0, sessionId: 'session-id' } })
afterEach(() => { mock.hooks.clear(); mock.taps.clear(); vi.clearAllMocks(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })

describe('real task CLI adapter', () => {
  it.each(['claude', 'codex'] as const)('starts %s with its selected model and keeps long assignments off the command line', tool => {
    mock.dir = temp(); mock.launch.mockReturnValue({ id: 'terminal', pid: 0, sessionId: 'session-id' })
    startTaskCli({ ...task(tool), model: 'chosen-model' }, 'C:\\checkout', 'Detailed assignment\n'.repeat(3000), vi.fn(), vi.fn())
    const spec = mock.launch.mock.calls[0][0]
    expect(spec.kind).toBe(tool)
    expect(spec.cwd).toBe('C:\\checkout')
    expect(spec.args).toContain('chosen-model')
    expect(spec.args.join(' ').length).toBeLessThan(1500)
    expect(spec.args).not.toContain('exec')
    expect(spec.args).not.toContain('-p')
    expect(readFileSync(join(mock.dir, 'task-assignments', 'assignment-id.md'), 'utf8')).toBe('Detailed assignment\n'.repeat(3000))
  })

  it('routes only the owning terminal hooks and waits for actual exit before releasing its lifetime', async () => {
    mock.dir = temp(); mock.launch.mockReturnValue({ id: 'terminal', pid: 0 })
    const state = vi.fn(), exited = vi.fn()
    const cli = startTaskCli(task(), 'C:\\checkout', 'Assignment', state, exited)
    mock.hooks.forEach(hook => hook({ agentId: 'other', event: 'Stop', at: 1 }))
    expect(state).not.toHaveBeenCalled()
    mock.hooks.forEach(hook => hook({ agentId: 'terminal', event: 'Stop', at: 1, sessionId: 'session-id', lastReply: 'Handoff' }))
    expect(state).toHaveBeenCalledWith('idle', 'session-id', 'Handoff')
    let closed = false
    const closing = cli.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    expect(mock.kill).toHaveBeenCalledWith('terminal')
    mock.taps.forEach(tap => tap.exit?.('terminal', 0))
    await closing
    expect(cli.exited).toBe(true)
    expect(mock.hooks.size).toBe(0)
    expect(mock.taps.size).toBe(0)
  })

  it('does not infer completion from startup or unrelated notifications', () => {
    const event = (event: string, source?: string) => ({ agentId: 'a', event, source, at: 1 })
    expect(taskCliState(event('SessionStart'))).toBeUndefined()
    expect(taskCliState(event('CodexState', 'idle'))).toBeUndefined()
    expect(taskCliState(event('Notification'))).toBeUndefined()
    expect(taskCliState(event('CodexState', 'done'))).toBe('idle')
    expect(taskCliState(event('UserPromptSubmit'))).toBe('working')
  })

  it('prefers the Claude Stop reply because the transcript may not be flushed yet', async () => {
    const t = task(); t.run!.result = 'Final hook reply'
    expect(await taskCliResult(t)).toBe('Final hook reply')
    expect(mock.file).not.toHaveBeenCalled()
  })

  it('uses only the latest Codex turn and excludes commentary from handoffs', async () => {
    const file = join(temp(), 'rollout.jsonl')
    writeFileSync(file, [
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Old reply' }] } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Working...' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Latest handoff' }] } }
    ].map(entry => JSON.stringify(entry)).join('\n'))
    mock.codexFile.mockResolvedValue(file)
    expect(await taskCliResult(task('codex'))).toBe('Latest handoff')
  })
})
