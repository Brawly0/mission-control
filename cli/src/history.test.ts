import { afterEach, beforeEach, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendHistory, clearHistory, historyContext, historyPath, readHistory, type HistoryEntry } from './history'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mc-history-')); execFileSync('git', ['init', root], { windowsHide: true, stdio: 'ignore' }) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
const entry: HistoryEntry = { at: 1, request: 'Build\nreader', outcome: 'committed', summary: 'Done', branch: 'mc/test', runId: 'abc' }
it('round-trips entries, skips corruption, limits and clears history', () => {
  expect(readHistory(root)).toEqual([])
  appendHistory(root, entry)
  appendFileSync(historyPath(root), 'corrupt\nnull\n{}\n')
  appendHistory(root, { ...entry, at: 2, outcome: 'answered' })
  expect(readHistory(root)).toHaveLength(2)
  expect(readHistory(root, 1)[0].at).toBe(2)
  expect(historyContext(readHistory(root), 1)).toEqual(['"Build reader" → answered: Done'])
  clearHistory(root)
  expect(readHistory(root)).toEqual([])
})
it('reads only recent complete records from large history', () => {
  appendHistory(root, { ...entry, answer: 'x'.repeat(1024 * 1024) })
  appendHistory(root, { ...entry, at: 3 })
  expect(readHistory(root)).toEqual([{ ...entry, at: 3 }])
  expect(() => appendHistory(join(root, 'missing'), entry)).not.toThrow()
})
