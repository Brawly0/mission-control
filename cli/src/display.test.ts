import { describe, expect, it } from 'vitest'
import { relativeTo, unwrapShell } from './agents'

describe('display helpers', () => {
  it('strips the PowerShell wrapper Codex adds on Windows', () => {
    expect(unwrapShell(String.raw`"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command 'npm test'`)).toBe('npm test')
    expect(unwrapShell('powershell.exe -Command "Get-ChildItem -Force"')).toBe('Get-ChildItem -Force')
    expect(unwrapShell('git status')).toBe('git status')
  })
  it('shows paths relative to the worktree, whatever the slashes or case', () => {
    const cwd = String.raw`C:\Users\me\repo\.claude\worktrees\duo-ab12`
    expect(relativeTo(cwd, 'Write C:/Users/me/repo/.claude/worktrees/duo-ab12/src/a.ts')).toBe('Write src/a.ts')
    expect(relativeTo(cwd, 'Read c:/users/ME/repo/.claude/worktrees/duo-ab12/b.ts')).toBe('Read b.ts')
    expect(relativeTo(cwd, 'Read D:/other/file.ts')).toBe('Read D:/other/file.ts')
  })
})

describe('long worktree paths', () => {
  it('stay whole until the worktree prefix is removed', async () => {
    const { claudeEvent } = await import('./agents')
    const cwd = 'C:/' + 'x'.repeat(150) + '/duo-ab12'
    const [ev] = claudeEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: cwd + '/src/strings.js' } }] } }, { ok: false, text: '', ms: 0 })
    expect(relativeTo(cwd, ev.text)).toBe('Read src/strings.js')
  })
})
