import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeEvent, codexArgs, codexEvent, describeClaudeTool, type AgentResult } from './agents'
import { firstLine, overlaps, ownedPath, parseDuoPlan, plannerPrompt, reviewPrompt, workerPrompt, type DuoPlan } from './plan'

const plan = (claudeFiles: string[], codexFiles: string[]) => JSON.stringify({
  summary: 'Backend and frontend',
  contract: 'GET /api/items returns Item[]',
  claude: { title: 'API', prompt: 'Build the endpoint', files: claudeFiles },
  codex: { title: 'UI', prompt: 'Build the list', files: codexFiles }
})

describe('parseDuoPlan', () => {
  it('reads a plain or fenced JSON plan', () => {
    const p = parseDuoPlan(plan(['src/api/'], ['src/ui/List.tsx']))
    expect(p.claude.files).toEqual(['src/api/'])
    expect(p.contract).toContain('/api/items')
    expect(parseDuoPlan('```json\n' + plan(['a.ts'], ['b.ts']) + '\n```').codex.title).toBe('UI')
  })

  it('normalises Windows and ./ paths', () => {
    expect(parseDuoPlan(plan(['.\\src\\a.ts'], ['b.ts'])).claude.files).toEqual(['src/a.ts'])
  })

  it('rejects prose, missing halves and shared files', () => {
    expect(() => parseDuoPlan('Here is the plan: {}')).toThrow(/JSON/)
    expect(() => parseDuoPlan(JSON.stringify({ summary: 'x', claude: { title: 'a', prompt: 'b', files: ['a'] } }))).toThrow(/Codex part/)
    expect(() => parseDuoPlan(plan(['src/'], ['src/ui/a.ts']))).toThrow(/both halves own/)
    expect(() => parseDuoPlan(plan(['README.md'], ['readme.md']))).toThrow(/both halves own/)
  })

  it('rejects unsafe paths', () => {
    for (const bad of ['/etc/x', 'C:/x', '../x', 'src/*.ts', 'a//b', '.']) expect(() => ownedPath(bad), bad).toThrow()
  })
})

describe('overlaps', () => {
  it('finds folder containment both ways, case-insensitively', () => {
    expect(overlaps(['src/ui'], ['SRC/ui/a.ts'])).toHaveLength(1)
    expect(overlaps(['src/ui-kit/a.ts'], ['src/ui/'])).toHaveLength(0)
  })
})

describe('prompts', () => {
  const p: DuoPlan = parseDuoPlan(plan(['src/api/'], ['src/ui/']))
  it('keeps the request as data in the planner prompt', () => {
    expect(plannerPrompt('make "x"')).toContain(JSON.stringify('make "x"'))
  })
  it('tells each worker its files and the files to leave alone', () => {
    const w = workerPrompt('req', p, 'codex')
    expect(w).toMatch(/You are Codex/)
    expect(w).toMatch(/you own[\s\S]*- src\/ui\//)
    expect(w).toMatch(/Do NOT edit[\s\S]*- src\/api\//)
    expect(w).toContain('GET /api/items')
  })
  it('asks the reviewer for the other half with its diff', () => {
    const r = reviewPrompt('req', p, 'claude', 'did the UI', '+ new line')
    expect(r).toMatch(/review Codex's half/)
    expect(r).toContain('+ new line')
    expect(r).toContain('- src/ui/')
  })
  it('takes a clean first line', () => {
    expect(firstLine('\n## Added the API\nmore')).toBe('Added the API')
    expect(firstLine('x'.repeat(100), 10)).toHaveLength(10)
  })
})

describe('agent arguments', () => {
  it('keeps Claude read-only for planning and allows read-only git when editing', () => {
    expect(claudeArgs('plan', 'id')).toEqual(expect.arrayContaining(['--permission-mode', 'plan', '--session-id', 'id']))
    const edit = claudeArgs('edit', 'id', 'sonnet')
    expect(edit).toEqual(expect.arrayContaining(['acceptEdits', 'Bash(git diff:*)', '--model', 'sonnet']))
    expect(claudeArgs('full', 'id')).not.toContain('--allowedTools')
  })
  it('maps access to Codex sandboxes and reads the prompt from stdin', () => {
    expect(codexArgs('plan').join(' ')).toContain('sandbox_mode="read-only"')
    expect(codexArgs('edit').join(' ')).toContain('sandbox_mode="workspace-write"')
    expect(codexArgs('full')).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(codexArgs('edit').at(-1)).toBe('-')
  })
})

describe('stream events', () => {
  const fresh = (): AgentResult => ({ ok: false, text: '', ms: 0 })
  it('reads Claude tool calls and the final result', () => {
    const r = fresh()
    expect(claudeEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:\\r\\a.ts' } }] } }, r)).toEqual([{ kind: 'tool', text: 'Edit C:/r/a.ts' }])
    claudeEvent({ type: 'result', subtype: 'success', result: 'Done', total_cost_usd: 0.5, session_id: 's' }, r)
    expect(r).toMatchObject({ ok: true, text: 'Done', costUsd: 0.5, sessionId: 's' })
    const bad = fresh()
    claudeEvent({ type: 'result', subtype: 'error_max_turns', is_error: true }, bad)
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('error_max_turns')
  })
  it('reads Codex commands, file changes, messages and usage', () => {
    const r = fresh()
    codexEvent({ type: 'thread.started', thread_id: 't1' }, r)
    expect(codexEvent({ type: 'item.started', item: { type: 'command_execution', command: 'npm test' } }, r)[0].text).toBe('$ npm test')
    expect(codexEvent({ type: 'item.completed', item: { type: 'file_change', changes: [{ kind: 'add', path: 'src/x.ts' }] } }, r)[0].text).toBe('Write src/x.ts')
    codexEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'All done' } }, r)
    codexEvent({ type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 200 } }, r)
    expect(r).toMatchObject({ ok: true, text: 'All done', sessionId: 't1', tokens: 1200 })
  })
  it('describes Claude tools briefly', () => {
    expect(describeClaudeTool('Bash', { command: 'npm run build' })).toBe('$ npm run build')
    expect(describeClaudeTool('Grep', { pattern: 'TODO' })).toBe('Grep TODO')
  })
})
