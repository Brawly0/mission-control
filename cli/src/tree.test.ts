import { describe, expect, it } from 'vitest'
import { activity, addOutput, addTool, auraColor, classify, finishTree, newTree, renderTree, summary } from './tree'
import { strip } from './ui'

const names = { claude: 'Claude', codex: 'Codex' }
const draw = (trees: ReturnType<typeof newTree>[], width = 110, height = 40, frame = 7) =>
  renderTree(trees, { frame, width, height, aura: 'mood', phase: 'build', names, duration: () => '12s' }).map(strip)

describe('work tree state', () => {
  it('puts each step in the right box', () => {
    expect(classify('$ npm test')).toMatchObject({ kind: 'terminal', item: '$ npm test', itemKind: 'cmd' })
    expect(classify('Edit src/cli/ui.ts')).toMatchObject({ kind: 'folder', label: 'src/cli/', item: 'ui.ts', itemKind: 'edit' })
    expect(classify('Read README.md')).toMatchObject({ kind: 'folder', label: './', item: 'README.md', itemKind: 'read' })
    expect(classify('Grep TODO')).toMatchObject({ kind: 'search', item: 'TODO' })
    expect(classify('WebFetch https://docs.example.com/a')).toMatchObject({ kind: 'web', item: 'docs.example.com' })
    expect(classify('mcp__github__get_me')).toMatchObject({ kind: 'connector', label: 'github', item: 'get me' })
    expect(classify('git.status')).toMatchObject({ kind: 'connector', label: 'git' })
  })
  it('keeps boxes for the whole turn, closes steps, and tracks changed files', () => {
    const t = newTree('claude', 'build', 0)
    addTool(t, 'Read src/a.ts', 1)
    addTool(t, 'Edit src/a.ts', 2)
    addTool(t, '$ npm test', 3)
    expect(activity(t)).toBe('Running npm test')
    addOutput(t, false, 4)
    expect(t.groups.map(g => g.label)).toEqual(['src/', 'terminal'])
    expect(t.groups[0].items).toHaveLength(1)
    expect(t.groups[0].items[0]).toMatchObject({ kind: 'edit', state: 'ok' })
    expect(t.groups[1].items[0].state).toBe('fail')
    expect(t.changed).toEqual(['src/a.ts'])
    expect(t.steps).toBe(3)
    expect(auraColor('mood', t, 5)).toBe(203)
    finishTree(t, true, 12_000, 6)
    expect(strip(summary(t, 'Claude', '12s'))).toBe('  ✦ Claude build done · 12s · 3 steps · 1 file · changed a.ts')
  })
})

describe('work tree drawing', () => {
  const busy = () => {
    const a = newTree('claude', 'build', 0), b = newTree('codex', 'build', 0)
    for (let i = 0; i < 6; i++) addTool(a, `Edit src/mod${i % 3}/file${i}.ts`, i)
    addTool(a, '$ npm test', 8)
    addTool(b, 'Read index.js', 1)
    addTool(b, 'WebSearch electron docs', 2)
    return [a, b]
  }
  it('draws both agents side by side, with up to 3 files per box', () => {
    const lines = draw(busy())
    expect(lines[0]).toContain('mc · build · 2 running')
    expect(lines.some(l => l.includes('CLAUDE') && l.includes('CODEX'))).toBe(true)
    expect(lines.some(l => l.includes('src/mod0/'))).toBe(true)
    expect(lines.some(l => l.includes('Running npm test'))).toBe(true)
    expect(lines.some(l => l.includes('Browsing electron docs'))).toBe(true)
  })
  it('never draws wider than the terminal, and shrinks to fit the height', () => {
    for (const width of [60, 84, 110, 160]) for (const line of draw(busy(), width)) expect([...line].length).toBeLessThanOrEqual(width)
    const tight = draw(busy(), 110, 12)
    expect(tight.length).toBeLessThanOrEqual(12)
    expect(tight.join('\n')).toContain('CLAUDE')
  })
  it('animates: frames differ while running, not after finishing', () => {
    const trees = busy()
    expect(draw(trees, 110, 40, 3).join('\n')).not.toBe(draw(trees, 110, 40, 4).join('\n'))
  })
})
