import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeEvent, codexArgs, codexEvent, describeClaudeTool, type AgentResult } from './agents'
import { firstLine, overlaps, ownedPath, parseDuoPlan, parseReport, plannerPrompt, reviewPrompt, soloPlan, workerPrompt, workers, type DuoPlan } from './plan'

const plan = (claudeFiles: string[], codexFiles: string[]) => JSON.stringify({
  summary: 'Backend and frontend',
  contract: 'GET /api/items returns Item[]',
  claude: { title: 'API', prompt: 'Build the endpoint', files: claudeFiles },
  codex: { title: 'UI', prompt: 'Build the list', files: codexFiles }
})

describe('parseDuoPlan', () => {
  it('reads a plain or fenced JSON plan', () => {
    const p = parseDuoPlan(plan(['src/api/'], ['src/ui/List.tsx']))
    expect(p.halves.claude!.files).toEqual(['src/api/'])
    expect(p.contract).toContain('/api/items')
    expect(parseDuoPlan('```json\n' + plan(['a.ts'], ['b.ts']) + '\n```').halves.codex!.title).toBe('UI')
  })

  it('normalises Windows and ./ paths', () => {
    expect(parseDuoPlan(plan(['.\\src\\a.ts'], ['b.ts'])).halves.claude!.files).toEqual(['src/a.ts'])
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
    expect(r).toMatch(/Review Codex's work/)
    expect(r).toContain('+ new line')
    expect(r).toContain('- src/ui/')
  })
  it('takes a clean first line', () => {
    expect(firstLine('\n## Added the API\nmore')).toBe('Added the API')
    expect(firstLine('x'.repeat(100), 10)).toHaveLength(10)
  })
})

describe('routing', () => {
  it('reads an answer without any builders', () => {
    const p = parseDuoPlan(JSON.stringify({ mode: 'answer', summary: 'How auth works', answer: '## Auth\nTokens live in `src/auth.ts`.' }))
    expect(p.mode).toBe('answer')
    expect(workers(p)).toEqual([])
    expect(p.answer).toContain('src/auth.ts')
  })
  it('reads a solo plan: one owner, owns everything, keeps the planner context', () => {
    const p = parseDuoPlan(JSON.stringify({ mode: 'solo', summary: 'Fix the typo', context: 'Typo is in README.md line 3', owner: 'codex', codex: { title: 'Fix typo', prompt: 'Fix it' } }))
    expect(workers(p)).toEqual(['codex'])
    expect(p.halves.codex!.files).toEqual([])
    expect(p.context).toContain('README.md')
    const w = workerPrompt('fix the typo', p, 'codex')
    expect(w).toContain('WHAT THE PLANNER ALREADY FOUND')
    expect(w).not.toMatch(/other half/)
  })
  it('refuses a solo plan when two halves were asked for, and an unknown owner', () => {
    const solo = JSON.stringify({ mode: 'solo', summary: 's', owner: 'claude', claude: { title: 't', prompt: 'p' } })
    expect(() => parseDuoPlan(solo, 'split')).toThrow(/two halves/)
    expect(() => parseDuoPlan(JSON.stringify({ mode: 'solo', summary: 's', owner: 'gpt' }))).toThrow(/owner/)
  })
  it('offers solo only when the user allows it, and passes earlier requests along', () => {
    expect(plannerPrompt('x', 'split')).not.toContain('"mode":"solo"')
    expect(plannerPrompt('x', 'auto')).toContain('"mode":"solo"')
    expect(plannerPrompt('x', 'auto', ['"add login" → committed'])).toContain('EARLIER IN THIS SESSION')
  })
  it('makes a one-agent plan without a planner', () => {
    const p = soloPlan('add a --json flag', 'claude')
    expect(workers(p)).toEqual(['claude'])
    expect(workerPrompt('add a --json flag', p, 'claude')).toMatch(/Changed:[\s\S]*Checked:[\s\S]*Notes:/)
  })
  it('keeps a resumed review prompt short', () => {
    const p = parseDuoPlan(plan(['src/api/'], ['src/ui/']))
    const resumed = reviewPrompt('req', p, 'claude', 'did the UI', '+ line', true)
    const fresh = reviewPrompt('req', p, 'claude', 'did the UI', '+ line', false)
    expect(resumed).not.toContain('REQUEST:')
    expect(fresh).toContain('REQUEST:')
    expect(resumed.length).toBeLessThan(fresh.length)
  })
})

describe('parseReport', () => {
  it('reads the fixed report, including bold headings and wrapped bullets', () => {
    const r = parseReport('Done.\n\n**Changed:**\n- src/a.ts: new parser\n  that handles quotes\n- src/b.ts: wired it\nChecked:\n- npm test: 12 passed\nNotes:\n- none')
    expect(r.changed).toEqual(['src/a.ts: new parser that handles quotes', 'src/b.ts: wired it'])
    expect(r.checked).toEqual(['npm test: 12 passed'])
    expect(r.notes).toEqual([])
    expect(r.rest).toBe('Done.')
  })
  it('reads review verdicts and their fixes', () => {
    expect(parseReport('Verdict: ok')).toMatchObject({ verdict: 'ok', fixes: [] })
    expect(parseReport('Looked at it.\nVerdict: fixed\n- src/ui.ts: null check\n- src/ui.ts: wrong route')).toMatchObject({ verdict: 'fixed', fixes: ['src/ui.ts: null check', 'src/ui.ts: wrong route'] })
  })
  it('leaves free-form replies in rest', () => {
    expect(parseReport('I added the button.').rest).toBe('I added the button.')
  })
})

describe('agent arguments', () => {
  it('continues a session for the review', () => {
    expect(claudeArgs('edit', 'new', undefined, 'old')).toEqual(expect.arrayContaining(['--resume', 'old']))
    expect(claudeArgs('edit', 'new', undefined, 'old')).not.toContain('--session-id')
    expect(codexArgs('edit', undefined, 't1').slice(0, 3)).toEqual(['exec', 'resume', 't1'])
  })
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
  it('shows Claude thinking, edit sizes, command results and output tokens', () => {
    const r = fresh()
    expect(claudeEvent({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 197 }, r)).toEqual([{ kind: 'thinking', text: '', tokens: 197 }])
    const edit = claudeEvent({ type: 'assistant', message: { id: 'm1', usage: { output_tokens: 40 }, content: [
      { type: 'thinking', thinking: '', signature: 'x' },
      { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.ts', old_string: 'a', new_string: 'a\nb\nc' } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }
    ] } }, r)
    expect(edit).toEqual([
      { kind: 'tool', text: 'Edit a.ts', detail: '+3 −1' },
      { kind: 'tool', text: '$ npm test' },
      { kind: 'usage', text: '', tokens: 40 }
    ])
    const results = claudeEvent({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
      { type: 'tool_result', tool_use_id: 't2', content: 'running\nTests: 12 passed' }
    ] } }, r)
    expect(results).toEqual([{ kind: 'output', text: 'Tests: 12 passed (2 lines)', ok: true }])
    expect(claudeEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'String not found in file' }] } }, r)[0]).toMatchObject({ kind: 'output', ok: false })
  })
  it('shows Codex reasoning, to-dos and failed commands', () => {
    const r = fresh()
    expect(codexEvent({ type: 'item.completed', item: { type: 'reasoning', text: '**Planning the parser**' } }, r)).toEqual([{ kind: 'thinking', text: 'Planning the parser' }])
    expect(codexEvent({ type: 'item.updated', item: { type: 'todo_list', items: [{ text: 'Read code', completed: true }, { text: 'Write tests', completed: false }] } }, r)).toEqual([{ kind: 'todo', text: 'Write tests', detail: '1/2' }])
    const [out] = codexEvent({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', exit_code: 1, aggregated_output: 'x\nError: 2 failed\ny' } }, r)
    expect(out).toEqual({ kind: 'output', text: 'exit 1 · Error: 2 failed (3 lines)', ok: false })
    codexEvent({ type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } }, r)
    expect(r.cached).toBe(800)
  })
  it('describes Claude tools briefly', () => {
    expect(describeClaudeTool('Bash', { command: 'npm run build' })).toBe('$ npm run build')
    expect(describeClaudeTool('Grep', { pattern: 'TODO' })).toBe('Grep TODO')
  })
})
