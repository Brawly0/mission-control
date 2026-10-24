import { describe, expect, it } from 'vitest'
import { commitMessage, humanPrompt, parseAiRecap, parseNames, recapBuilder, recapMaterial } from './recap'

const T = (min: number) => new Date(Date.UTC(2026, 9, 24, 10, min)).toISOString()
const user = (text: string, min: number, extra = {}) => ({ type: 'user', timestamp: T(min), cwd: 'C:\\app', message: { content: text }, ...extra })
const reply = (id: string, min: number, content: unknown[]) => ({ type: 'assistant', timestamp: T(min), message: { id, content } })
const tool = (name: string, input: object) => ({ type: 'tool_use', name, input })

describe('recapBuilder', () => {
  it('collects prompts, files, commits, the last reply and active time', () => {
    const b = recapBuilder('s1')
    const entries = [
      user('fix the login page', 0),
      reply('m1', 1, [{ type: 'text', text: 'Looking.' }, tool('Edit', { file_path: 'C:\\app\\src\\login.ts' })]),
      reply('m1', 2, [tool('Edit', { file_path: 'C:/app/src/login.ts' }), tool('Write', { file_path: 'C:\\app\\src\\auth.ts' })]),
      user('tool result', 3, { message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
      reply('m2', 4, [tool('Bash', { command: 'git add -A && git commit -m "fix: login redirect"' }), tool('Bash', { command: 'npm test' })]),
      user('<command-name>/compact</command-name>', 5),
      { type: 'system', subtype: 'compact_boundary', timestamp: T(6) },
      user('summary', 6, { isCompactSummary: true }),
      // A long break: not counted as active time.
      user('now add a remember-me box', 60),
      user('and tests', 61),
      user('and docs', 62),
      user('ship it', 63),
      reply('m3', 64, [{ type: 'text', text: 'Done: login redirect fixed,' }]),
      reply('m3', 65, [{ type: 'text', text: 'remember-me added.' }])
    ]
    for (const e of entries) b.add(e)
    const r = b.done()
    expect(r.prompts).toBe(5)
    expect(r.firstPrompts.map((p) => p.text)).toEqual(['fix the login page', 'now add a remember-me box', 'and tests'])
    expect(r.lastPrompts.map((p) => p.text)).toEqual(['and docs', 'ship it'])
    expect(r.files).toEqual([
      { path: 'src\\login.ts', edits: 2, created: false },
      { path: 'src\\auth.ts', edits: 1, created: true }
    ])
    expect(r.commands).toBe(2)
    expect(r.commits).toEqual(['fix: login redirect'])
    expect(r.lastReply).toBe('Done: login redirect fixed,\n\nremember-me added.')
    expect(r.compactions).toBe(1)
    expect(r.activeMinutes).toBe(6 + 5)
    expect(recapMaterial(r, 'Fix login')).toContain('Files changed (2): src\\login.ts, src\\auth.ts (new)')
  })
  it('ignores sidechains (subagents)', () => {
    const b = recapBuilder('s')
    b.add(user('task for a subagent', 0, { isSidechain: true }))
    expect(b.done().prompts).toBe(0)
  })
})

describe('helpers', () => {
  it('reads commit messages from -m and heredocs', () => {
    expect(commitMessage(`git commit -m 'feat: x'`)).toBe('feat: x')
    expect(commitMessage(`git commit -m "$(cat <<'EOF'\nfeat: v0.16 inbox\n\nCo-Authored-By: C\nEOF\n)"`)).toBe('feat: v0.16 inbox')
    expect(commitMessage('git status')).toBe('')
  })
  it('skips interrupts and commands as prompts', () => {
    expect(humanPrompt(user('[Request interrupted by user]', 0))).toBe('')
    expect(humanPrompt(user('real question', 0))).toBe('real question')
  })
  it('parses Claude replies', () => {
    expect(parseAiRecap('```json\n{"title":"Login fix","bullets":["Fixed redirect"],"next":"Add tests"}\n```')).toEqual({ title: 'Login fix', bullets: ['Fixed redirect'], next: 'Add tests' })
    expect(parseAiRecap('no json')).toBeNull()
    expect(parseNames('{"1":"Campaign update","2":"\\"Login fix\\""}')).toEqual({ 1: 'Campaign update', 2: 'Login fix' })
  })
})
