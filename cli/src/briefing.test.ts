import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { briefingMarkdown, latestBriefing, writeBriefing } from './briefing'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('builds every section with outcomes, short answers and merge next steps', () => {
  const markdown = briefingMarkdown({ project: 'My Project', date: new Date(2026, 10, 18, 9, 5), history: [
    { at: 1, request: 'Build it', outcome: 'committed', summary: 'Built', branch: 'mc/test', runId: 'abc' },
    { at: 2, request: 'Explain', outcome: 'answered', summary: 'Explained', answer: 'The answer' },
    { at: 3, request: 'Fix it', outcome: 'failed', summary: 'Tests failed' },
    { at: 4, request: 'Continue', outcome: 'stopped', summary: 'Interrupted' }
  ] })
  for (const section of ['Goal', 'Done and verified', 'Decisions', 'Open problems', 'Next steps', 'Files that matter']) expect(markdown).toContain(`## ${section}`)
  for (const text of ['# Session briefing: My Project (2026-11-18)', 'mc/test', '/merge abc', 'The answer', 'Tests failed', 'Interrupted']) expect(markdown).toContain(text)
})
it('writes local-time names and returns the newest briefing by filename', () => {
  const root = mkdtempSync(join(tmpdir(), 'My Project-')); roots.push(root)
  expect(latestBriefing(root)).toBeUndefined()
  const path = writeBriefing(root, 'newer', new Date(2026, 10, 18, 9, 5))
  expect(basename(path)).toMatch(/^2026-11-18-0905-my-project-.*-mc\.md$/)
  writeBriefing(root, 'older', new Date(2026, 10, 17, 10, 0))
  expect(latestBriefing(root)).toEqual({ path, text: 'newer' })
})
