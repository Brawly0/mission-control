import { NAME, firstLine, other, type Report, type Side } from './plan'
import { c, cut, wrap } from './ui'

/**
 * The Done card's body, kept short on purpose: one line per agent on what you got, then one line each for the
 * checks and the review, and at most two notes. Agents can write a lot; the full replies stay available in /report.
 */
export interface ResultInput {
  builders: Side[]
  reports: Partial<Record<Side, Report>>
  reviews: Partial<Record<Side, Report>>
  /** The planner's title per builder, used when an agent left out its summary. */
  titles: Partial<Record<Side, string>>
}

const label = (title: string) => c.bold(title.padEnd(10))

/** What one agent delivered, in one or two lines. */
export function gotLine(side: Side, report: Report | undefined, title = ''): string {
  if (report?.summary) return report.summary
  const files = report?.changed.length ?? 0
  const base = title || firstLine(report?.rest ?? '', 160) || 'done'
  return files ? `${base} (${files} file${files === 1 ? '' : 's'})` : base
}

/**
 * "npm.cmd test: 45 files, 434 tests passed" and "npm test: 434 tests passed." become one entry, "npm test ✓ 434 passed".
 * Checks from both agents and both reviews are merged; a later result for the same command replaces an earlier one.
 */
export function compactChecks(items: string[]): string[] {
  const byCommand = new Map<string, string>()
  for (const raw of items) {
    const item = raw.replace(/`/g, '').replace(/\bnpm\.cmd\b/g, 'npm').replace(/\s+/g, ' ').trim()
    if (!item || /^none\.?$/i.test(item)) continue
    // "npm run cli:build: passed": the result starts after ": ", not at the colon inside the script name.
    const colon = item.search(/:\s/)
    const command = (colon > 0 ? item.slice(0, colon) : item).trim()
    const result = colon > 0 ? item.slice(colon + 2).trim() : ''
    const failed = /\b(fail(ed|s|ing)?|error|broken|could ?n[o']t)\b/i.test(result) && !/\b0 fail/i.test(result)
    const count = /(\d+)\s+(?:tests?\s+)?pass/i.exec(result)
    // "fails until Claude's half lands (expected)" is not a real failure, but not a pass either.
    const mark = failed ? (/\bexpected\b/i.test(result) ? c.dim('–') : c.red('✗')) : c.green('✓')
    const shown = `${cut(command, 40)} ${mark}${count ? ` ${count[1]} passed` : ''}`
    byCommand.set(command.toLowerCase(), shown)
  }
  return [...byCommand.values()]
}

/** Notes worth the user's time: not "none", not messages one agent left for the other. */
export function userNotes(notes: string[]): string[] {
  return notes.filter(n => n.trim() && !/^none\.?$/i.test(n.trim()) && !/^(for |to )?(claude|codex)\b\s*[:,-]/i.test(n.trim()) && !/nothing (else )?to change/i.test(n))
}

/** "Codex fixed 2 things in Claude's part · Claude checked Codex's part: ok". */
export function reviewLine(reviews: Partial<Record<Side, Report>>, solo: boolean): string {
  const parts: string[] = []
  for (const reviewer of Object.keys(reviews) as Side[]) {
    const r = reviews[reviewer]!
    const whose = solo ? `${NAME[other(reviewer)]}'s work` : `${NAME[other(reviewer)]}'s part`
    if (r.verdict === 'ok') parts.push(`${NAME[reviewer]} checked ${whose}: ${c.green('ok')}`)
    else if (r.verdict === 'fixed') parts.push(`${NAME[reviewer]} fixed ${r.fixes.length || 'some'} thing${r.fixes.length === 1 ? '' : 's'} in ${whose}`)
    else parts.push(`${NAME[reviewer]} reviewed ${whose}${r.notes[0]?.startsWith('Review failed') ? `: ${c.red('failed')}` : ''}`)
  }
  return parts.join(c.dim(' · '))
}

/** The card body: "What you got", then Checked / Review / Note rows, each wrapped to `width`. */
export function resultLines(o: ResultInput, width: number): string[] {
  const out: string[] = [c.bold('What you got')]
  for (const side of o.builders) {
    const lines = wrap(gotLine(side, o.reports[side], o.titles[side]), width - 12)
    const shown = lines.length > 2 ? [lines[0], cut(lines[1], width - 13) + (lines[1].endsWith('…') ? '' : '…')] : lines
    shown.forEach((l, i) => out.push((i ? ' '.repeat(12) : `  ${c[side]('•')} ${c[side](NAME[side].padEnd(8))}`) + l.replace(/`([^`]+)`/g, (_, t) => c.code(t))))
  }
  const row = (title: string, text: string) => { if (text) out.push(label(title) + text) }

  const checks = compactChecks([...o.builders.flatMap(s => o.reports[s]?.checked ?? []), ...(Object.values(o.reviews) as Report[]).flatMap(r => r.checked)])
  if (checks.length) {
    // As many checks as fit on one line, then "+N more".
    let shown = checks.length
    const line = (n: number) => checks.slice(0, n).join(c.dim(' · ')) + (n < checks.length ? c.dim(` · +${checks.length - n} more`) : '')
    while (shown > 1 && [...line(shown).replace(/\x1b\[[0-9;]*m/g, '')].length > width - 10) shown--
    row('Checked', line(shown))
  }
  row('Review', reviewLine(o.reviews, o.builders.length === 1))

  const notes = userNotes([...o.builders.flatMap(s => o.reports[s]?.notes ?? []), ...(Object.values(o.reviews) as Report[]).flatMap(r => r.notes)])
  for (const note of notes.slice(0, 2)) {
    const lines = wrap(note, width - 10)
    const shown = lines.length > 2 ? [lines[0], cut(lines[1], width - 11) + (lines[1].endsWith('…') ? '' : '…')] : lines
    shown.forEach((l, i) => out.push((i ? ' '.repeat(10) : label('Note')) + l.replace(/`([^`]+)`/g, (_, t) => c.code(t))))
  }
  if (notes.length > 2) out.push(' '.repeat(10) + c.dim(`+${notes.length - 2} more in /report`))
  return out
}
