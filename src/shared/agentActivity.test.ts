import { describe, expect, it } from 'vitest'
import { baseName, describeTool, isPermissionPrompt } from './agentActivity'

describe('describeTool', () => {
  it('names the file an edit writes to', () => {
    expect(describeTool('Edit', { file_path: 'C:\\repo\\src\\App.tsx' })).toEqual({ verb: 'Editing', target: 'App.tsx', file: 'C:\\repo\\src\\App.tsx' })
    expect(describeTool('Write', { file_path: '/r/a.md' })).toMatchObject({ verb: 'Writing', target: 'a.md', file: '/r/a.md' })
    expect(describeTool('NotebookEdit', { notebook_path: 'n.ipynb' }).file).toBe('n.ipynb')
  })

  it('shortens long commands to one line', () => {
    const a = describeTool('Bash', { command: 'npm   test\n  -- --watch=false ' + 'x'.repeat(200) })
    expect(a.verb).toBe('Running')
    expect(a.target.startsWith('npm test -- --watch=false')).toBe(true)
    expect(a.target.length).toBeLessThanOrEqual(90)
    expect(a.target.endsWith('…')).toBe(true)
  })

  it('covers search, web, subagents and MCP tools', () => {
    expect(describeTool('Grep', { pattern: 'TODO' })).toEqual({ verb: 'Searching for', target: 'TODO' })
    expect(describeTool('WebFetch', { url: 'https://example.com/x' }).target).toBe('example.com/x')
    expect(describeTool('Task', { description: 'Find the bug' })).toEqual({ verb: 'Delegating', target: 'Find the bug' })
    expect(describeTool('mcp__github__create_issue', {})).toEqual({ verb: 'Using github', target: 'create issue' })
    expect(describeTool('Mystery', null)).toEqual({ verb: 'Using', target: 'Mystery' })
  })

  it('takes either slash in base names', () => {
    expect(baseName('a/b\\c.ts')).toBe('c.ts')
    expect(baseName('c.ts')).toBe('c.ts')
  })
})

describe('isPermissionPrompt', () => {
  it('spots permission prompts only', () => {
    expect(isPermissionPrompt('Claude needs your permission to use Bash')).toBe(true)
    expect(isPermissionPrompt('x', 'permission_prompt')).toBe(true)
    expect(isPermissionPrompt('Codex needs your approval')).toBe(true)
    expect(isPermissionPrompt('Claude is waiting for your input', 'idle_prompt')).toBe(false)
  })
})
