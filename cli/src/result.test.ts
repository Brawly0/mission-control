import { describe, expect, it } from 'vitest'
import { parseReport } from './plan'
import { compactChecks, gotLine, resultLines, reviewLine, userNotes } from './result'
import { strip } from './ui'

// The reports from a real run (mc/duo-7da2), cut down: Claude wrote a long Changed section with nested bullets.
const claude = parseReport(`Changed:
- cli/src/ui.ts: \`promptBox(status, hint, suggest?)\` now shows a live slash-command menu under the box when the line starts with '/'. It shows up to 8 rows.
  - **How it hooks in:** readline's internal key handler is wrapped as an own property.
  - **Keys while the menu is open:** Tab/↓ go to the next item.
- cli/src/ui.test.ts: added tests for the menu.

Checked:
- \`npm test\`: 45 files, 434 tests passed (with Codex's \`suggestions\` in place)
- \`npm run cli:build\`: built cli/dist/mc.mjs
- \`npm run typecheck\`: no errors (this covers cli/src)

Notes:
- I couldn't test it in a live terminal. Please run \`node cli/dist/mc.mjs\` in a repo and try the menu.
- For Codex: nothing to change. ui.ts only imports \`type Suggestion\` from commands.ts.`)
const codex = parseReport(`Summary: New slash commands /usage, /new and /version, and /model with model names.
Changed:
- cli/src/commands.ts: ordered commands, aliases, shared suggestions and model completion.
Checked:
- npm.cmd test: 434 tests passed.
- npm.cmd run cli:build: passed.
Notes:
- Claude: shared contract is wired; your files were untouched.`)
const reviews = { codex: parseReport('Verdict: fixed\n- cli/src/ui.ts: reset Esc dismissal\n- cli/src/ui.ts: limit menu height'), claude: parseReport('Verdict: fixed\n- cli/src/main.ts: count runs only once they start') }

describe('the Done card', () => {
  it('keeps nested bullets out of the lists and reads the summary line', () => {
    expect(claude.changed).toHaveLength(2)
    expect(codex.summary).toBe('New slash commands /usage, /new and /version, and /model with model names.')
  })

  it('says what each agent delivered in one line: its summary, or the planned title with a file count', () => {
    expect(gotLine('codex', codex, 'x')).toBe(codex.summary)
    expect(gotLine('claude', claude, 'Live slash-command menu in the mc prompt')).toBe('Live slash-command menu in the mc prompt (2 files)')
  })

  it('merges checks from both agents into one entry per command', () => {
    const checks = compactChecks([...claude.checked, ...codex.checked]).map(strip)
    expect(checks).toEqual(['npm test ✓ 434 passed', 'npm run cli:build ✓', 'npm run typecheck ✓'])
    expect(compactChecks(['npm test: 2 failed']).map(strip)).toEqual(['npm test ✗'])
    expect(compactChecks(['npm test: 12 passed, 0 failed']).map(strip)).toEqual(['npm test ✓ 12 passed'])
  })

  it('drops notes the agents left for each other', () => {
    expect(userNotes([...claude.notes, ...codex.notes])).toEqual([claude.notes[0]])
  })

  it('sums the review up in one line', () => {
    expect(strip(reviewLine(reviews, false))).toBe("Codex fixed 2 things in Claude's part · Claude fixed 1 thing in Codex's part")
    expect(strip(reviewLine({ claude: parseReport('Verdict: ok') }, true))).toBe("Claude checked Codex's work: ok")
  })

  it('fits the whole body in a handful of lines', () => {
    const lines = resultLines({ builders: ['claude', 'codex'], reports: { claude, codex }, reviews, titles: { claude: 'Live slash-command menu in the mc prompt', codex: 'New slash commands' } }, 100).map(strip)
    expect(lines.length).toBeLessThanOrEqual(8)
    expect(lines.every(l => [...l].length <= 100)).toBe(true)
    expect(lines.join('\n')).toMatchInlineSnapshot(`
      "What you got
        • Claude  Live slash-command menu in the mc prompt (2 files)
        • Codex   New slash commands /usage, /new and /version, and /model with model names.
      Checked   npm test ✓ 434 passed · npm run cli:build ✓ · npm run typecheck ✓
      Review    Codex fixed 2 things in Claude's part · Claude fixed 1 thing in Codex's part
      Note      I couldn't test it in a live terminal. Please run node cli/dist/mc.mjs in a repo and try
                the menu."
    `)
  })
})
