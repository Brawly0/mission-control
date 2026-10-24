import { describe, expect, it } from 'vitest'
import { headings, noteName, parseFrontmatter, parseNote, resolveLink, wikilinksToMarkdown } from './vault'

const RELS = ['CLAUDE.md', 'README.md', 'docs/INDEX.md', 'docs/setup.md', 'docs/architecture.md', 'docs/decisions/0001-stack.md', 'docs/briefings/2026-10-24-x.md', 'docs/decisions/setup.md']

describe('parseFrontmatter', () => {
  it('reads values, inline lists and dash lists', () => {
    const { props, body } = parseFrontmatter('---\ntitle: "Setup"\ntags: [dev, build]\naliases:\n  - install\n  - run\ngenerated: claude\n---\n# Setup\n')
    expect(props).toEqual({ title: 'Setup', tags: ['dev', 'build'], aliases: ['install', 'run'], generated: 'claude' })
    expect(body).toBe('# Setup\n')
  })
  it('reads folded and literal block text, as skills use for descriptions', () => {
    const { props } = parseFrontmatter('---\nname: x\ndescription: >\n  Use when the user\n  asks for x.\nnotes: |\n  line 1\n  line 2\nmodel: sonnet\n---\nbody')
    expect(props).toEqual({ name: 'x', description: 'Use when the user asks for x.', notes: 'line 1\nline 2', model: 'sonnet' })
  })
  it('leaves notes without frontmatter alone', () => {
    expect(parseFrontmatter('# Hi\n---\n')).toEqual({ props: {}, body: '# Hi\n---\n' })
  })
})

describe('parseNote', () => {
  it('finds wikilinks and relative .md links, not ones in code or on the web', () => {
    const n = parseNote('# Arch\nSee [[setup]], [[decisions/0001-stack|the stack]] and [[INDEX#map]].\n[Readme](../README.md) [web](https://x.dev/a.md)\n`[[not-a-link]]`\n```\n[[nope]]\n```\n')
    expect(n.links.sort()).toEqual(['../README.md', 'INDEX', 'decisions/0001-stack', 'setup'])
    expect(n.title).toBe('Arch')
  })
  it('prefers the frontmatter title and reads tags', () => {
    const n = parseNote('---\ntitle: Status\ntags: "#a, b"\n---\n# Other\n')
    expect(n.title).toBe('Status')
    expect(n.tags).toEqual(['a', 'b'])
  })
})

describe('resolveLink', () => {
  it('resolves names case-insensitively, nearest folder first', () => {
    expect(resolveLink('index', 'docs/setup.md', RELS)).toBe('docs/INDEX.md')
    expect(resolveLink('setup', 'docs/architecture.md', RELS)).toBe('docs/setup.md')
    expect(resolveLink('setup', 'docs/decisions/0001-stack.md', RELS)).toBe('docs/decisions/setup.md')
    expect(resolveLink('decisions/0001-stack', 'docs/INDEX.md', RELS)).toBe('docs/decisions/0001-stack.md')
    expect(resolveLink('CLAUDE', 'docs/INDEX.md', RELS)).toBe('CLAUDE.md')
  })
  it('resolves relative paths from the linking note', () => {
    expect(resolveLink('../README.md', 'docs/INDEX.md', RELS)).toBe('README.md')
    expect(resolveLink('./decisions/0001-stack.md', 'docs/INDEX.md', RELS)).toBe('docs/decisions/0001-stack.md')
    expect(resolveLink('docs/setup.md', 'CLAUDE.md', RELS)).toBe('docs/setup.md')
  })
  it('returns null for missing notes', () => {
    expect(resolveLink('glossary', 'docs/INDEX.md', RELS)).toBeNull()
    expect(resolveLink('', 'docs/INDEX.md', RELS)).toBeNull()
  })
})

describe('wikilinksToMarkdown', () => {
  it('rewrites links with labels but not code', () => {
    expect(wikilinksToMarkdown('a [[setup]] b [[decisions/0001-stack|Stack]] `[[x]]`')).toBe('a [setup](mc-note:setup) b [Stack](mc-note:decisions%2F0001-stack) `[[x]]`')
  })
})

describe('headings and names', () => {
  it('lists headings with unique slugs, skipping code', () => {
    expect(headings('# Setup\n## Run it\n```\n# not\n```\n## Run it\n### See [[INDEX|home]]')).toEqual([
      { level: 1, text: 'Setup', slug: 'setup' },
      { level: 2, text: 'Run it', slug: 'run-it' },
      { level: 2, text: 'Run it', slug: 'run-it-1' },
      { level: 3, text: 'See home', slug: 'see-home' }
    ])
  })
  it('names notes by file name', () => {
    expect(noteName('docs/decisions/0001-stack.md')).toBe('0001-stack')
  })
})
