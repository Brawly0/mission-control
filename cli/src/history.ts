import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { commonDir } from './git'

export interface HistoryEntry {
  at: number
  request: string
  outcome: 'answered' | 'committed' | 'failed' | 'no changes' | 'stopped'
  summary: string
  answer?: string
  branch?: string
  runId?: string
  sides?: Array<'claude' | 'codex'>
}

export function historyPath(root: string): string { return join(commonDir(root), 'mc-history', 'history.jsonl') }

export function appendHistory(root: string, entry: HistoryEntry): void {
  try { const path = historyPath(root); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8') } catch { /* History must never interrupt a run. */ }
}

export function readHistory(root: string, limit = 50): HistoryEntry[] {
  if (limit <= 0) return []
  let fd: number | undefined
  try {
    fd = openSync(historyPath(root), 'r')
    const size = fstatSync(fd).size, start = Math.max(0, size - 256 * 1024)
    const offset = Math.max(0, start - 1), length = size - offset
    const buffer = Buffer.alloc(length)
    const bytes = readSync(fd, buffer, 0, length, offset)
    let text = buffer.subarray(0, bytes).toString('utf8')
    if (start > 0) text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : ''
    return text.split('\n').flatMap(line => {
      try {
        const e = JSON.parse(line)
        return e && Number.isFinite(e.at) && typeof e.request === 'string' && typeof e.summary === 'string' && ['answered', 'committed', 'failed', 'no changes', 'stopped'].includes(e.outcome) ? [e as HistoryEntry] : []
      } catch { return [] }
    }).slice(-limit)
  } catch { return [] } finally { if (fd !== undefined) closeSync(fd) }
}

export function clearHistory(root: string): void {
  const path = historyPath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '', 'utf8')
}

export function historyContext(entries: HistoryEntry[], max = 6): string[] {
  const one = (s: string) => s.replace(/\s+/g, ' ').trim()
  return max <= 0 ? [] : entries.slice(-max).map(e => `"${one(e.request)}" → ${e.outcome}: ${one(e.summary)}`)
}
