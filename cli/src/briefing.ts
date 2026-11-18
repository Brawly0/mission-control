import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { HistoryEntry } from './history'

const short = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 600)
function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

export function briefingMarkdown(o: { project: string; history: HistoryEntry[]; date?: Date }): string {
  const date = o.date ?? new Date(), history = o.history
  const done = history.filter(e => ['committed', 'answered', 'no changes'].includes(e.outcome))
  const problems = history.filter(e => e.outcome === 'failed' || e.outcome === 'stopped')
  const runs = history.filter(e => e.outcome === 'committed' && e.runId)
  const bullets = (items: string[], empty: string) => items.length ? items.map(s => `- ${s}`).join('\n') : `- ${empty}`
  return `# Session briefing: ${short(o.project)} (${stamp(date).slice(0, 10)})

## Goal
${bullets(history.slice(-1).map(e => short(e.request)), 'No requests recorded.')}

## Done and verified
${bullets(done.map(e => `${short(e.summary)}${e.answer ? ` — ${short(e.answer)}` : ''}${e.branch ? ` (branch: ${short(e.branch)})` : ''}${e.runId ? ` (run: ${short(e.runId)})` : ''}`), 'No completed work recorded.')}

## Decisions
- No separate decisions recorded; consult the history and answers above.

## Open problems
${bullets(problems.map(e => `${short(e.request)} — ${e.outcome}: ${short(e.summary)}`), 'No failures or stopped runs recorded.')}

## Next steps
${bullets(runs.map(e => `Check whether run ${short(e.runId!)} is already merged; if not, use /merge ${short(e.runId!)}.`), 'Continue from the latest request and resolve any open problems.')}

## Files that matter
- docs/briefings/ — session handoffs.
- Git common directory: mc-history/history.jsonl — persistent mc conversation history.
`
}

export function writeBriefing(root: string, markdown: string, date = new Date()): string {
  const slug = basename(resolve(root)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
  const dir = resolve(root, 'docs', 'briefings')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${stamp(date)}-${slug}-mc.md`)
  writeFileSync(path, markdown, 'utf8')
  return path
}

export function latestBriefing(root: string): { path: string; text: string } | undefined {
  const dir = resolve(root, 'docs', 'briefings')
  try {
    for (const name of readdirSync(dir).filter(n => n.endsWith('.md')).sort().reverse()) {
      try { const path = join(dir, name); return { path, text: readFileSync(path, 'utf8') } } catch { /* Try the next readable briefing. */ }
    }
  } catch { /* No briefings yet. */ }
  return undefined
}
