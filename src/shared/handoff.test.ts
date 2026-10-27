import { describe, expect, it } from 'vitest'
import { handoffMarkdown, handoffPrompt, otherTool, type HandoffInput } from './handoff'

const T = (min: number) => Date.UTC(2026, 9, 27, 10, min)

const base: HandoffInput = {
  from: 'claude',
  to: 'codex',
  projectName: 'Mission Control',
  cwd: 'C:\\app',
  title: 'Dark mode',
  sessionId: 'abc-123',
  recap: {
    sessionId: 'abc-123',
    startedAt: T(0),
    endedAt: T(40),
    activeMinutes: 35,
    prompts: 4,
    firstPrompts: [{ text: 'add a dark mode', at: T(0) }],
    lastPrompts: [{ text: 'now fix the\nsidebar colors', at: T(30) }],
    files: [
      { path: 'src\\theme.ts', edits: 3, created: false },
      { path: 'src\\dark.css', edits: 1, created: true }
    ],
    filesTotal: 2,
    commands: 5,
    commits: ['feat: dark mode'],
    lastReply: 'Done. The sidebar uses the new tokens.',
    compactions: 0
  },
  recent: [
    { role: 'user', text: 'now fix the sidebar colors', timestamp: T(30) },
    { role: 'assistant', text: 'Fixed in styles.css.', timestamp: T(31) }
  ],
  git: { branch: 'main', status: [' M src/theme.ts', '?? src/dark.css'], commits: ['a1b2c3d feat: dark mode'] },
  rules: ['CLAUDE.md'],
  transcript: 'C:\\Users\\me\\.claude\\projects\\C--app\\abc-123.jsonl',
  at: T(45)
}

describe('handoffMarkdown', () => {
  it('covers rules, asks, changes, git, the last reply and the latest exchange', () => {
    const md = handoffMarkdown(base)
    expect(md).toMatch(/^# Handoff: Claude to Codex/)
    expect(md).toContain("You're Codex, taking over this project from Claude.")
    expect(md).toContain('Read `CLAUDE.md` first.')
    expect(md).toContain('- add a dark mode')
    // Prompts are kept on one line.
    expect(md).toContain('- now fix the sidebar colors')
    expect(md).toContain('- `src\\dark.css` (new)')
    expect(md).toContain('- `src\\theme.ts` · 3 edits')
    expect(md).toContain('Branch: `main`')
    expect(md).toContain('?? src/dark.css')
    expect(md).toContain('a1b2c3d feat: dark mode')
    expect(md).toContain('> Done. The sidebar uses the new tokens.')
    expect(md).toContain('**User:**')
    expect(md).toContain('**Claude:**')
    expect(md).toContain('abc-123.jsonl')
  })

  it('says so when there are no rules, edits or repo', () => {
    const md = handoffMarkdown({ ...base, from: 'codex', to: 'claude', rules: [], git: null, recap: { ...base.recap, files: [], filesTotal: 0 } })
    expect(md).toContain('no CLAUDE.md or AGENTS.md')
    expect(md).toContain('Codex can also change files through shell commands')
    expect(md).not.toContain('## Where git stands now')
  })
})

describe('handoffPrompt', () => {
  it('points the new agent at the file, like a briefing', () => {
    expect(handoffPrompt('C:\\app\\docs\\briefings\\x.md', 'codex')).toMatch(/^Read the handoff at "C:\\app\\docs\\briefings\\x\.md"\. Codex worked on this project before you/)
    expect(otherTool('claude')).toBe('codex')
  })
})
