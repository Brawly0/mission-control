/**
 * The project docs vault: Markdown notes in docs/ (plus CLAUDE.md, README.md…) linked
 * Obsidian-style with [[wikilinks]]. Pure parsing and link resolution, shared by the main
 * process (indexing the vault) and the UI (rendering links).
 */

export interface ParsedNote {
  /** Frontmatter values; lists become arrays. */
  props: Record<string, string | string[]>
  /** The note without its frontmatter. */
  body: string
  title?: string
  tags: string[]
  /** Link targets as written: wikilink names and relative .md paths. */
  links: string[]
}

/** Reads `---` YAML frontmatter, the simple kind notes use: `key: value`, `key: [a, b]` and `- item` lists. */
export function parseFrontmatter(text: string): { props: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return { props: {}, body: text }
  const props: Record<string, string | string[]> = {}
  let listKey: string | null = null
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Block text: "key: |" keeps line breaks, "key: >" folds them into spaces.
    const block = /^([A-Za-z0-9_-]+):\s*([|>])[+-]?\s*$/.exec(line)
    if (block) {
      const body: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) body.push(lines[++i].trim())
      while (body.length && !body[body.length - 1]) body.pop()
      props[block[1]] = block[2] === '|' ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ').trim()
      listKey = null
      continue
    }
    const item = /^\s+-\s+(.*)$/.exec(line) ?? (listKey ? /^-\s+(.*)$/.exec(line) : null)
    if (item && listKey) {
      const cur = props[listKey]
      props[listKey] = [...(Array.isArray(cur) ? cur : []), unquote(item[1])]
      continue
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, key, raw] = kv
    listKey = null
    if (!raw) {
      listKey = key
      props[key] = []
    } else if (/^\[.*\]$/.test(raw.trim())) {
      props[key] = raw.trim().slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean)
    } else props[key] = unquote(raw.trim())
  }
  return { props, body: text.slice(m[0].length) }
}

function unquote(s: string): string {
  return s.replace(/^(["'])(.*)\1$/, '$2')
}

const WIKILINK = /\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g
const MDLINK = /\[[^\]\n]*\]\(<?([^)\s>]+\.md)(#[^)\s]*)?>?\)/gi

export function parseNote(text: string): ParsedNote {
  const { props, body } = parseFrontmatter(text)
  // Links inside code aren't links.
  const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const links = new Set<string>()
  for (const m of prose.matchAll(WIKILINK)) links.add(m[1].trim())
  for (const m of prose.matchAll(MDLINK)) if (!/^[a-z]+:/i.test(m[1])) links.add(decodeURIComponent(m[1]))
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(body)
  const title = typeof props.title === 'string' && props.title ? props.title : h1?.[1]
  const rawTags = props.tags ?? props.tag ?? []
  const tags = (Array.isArray(rawTags) ? rawTags : rawTags.split(/[,\s]+/)).map((t) => t.replace(/^#/, '')).filter(Boolean)
  return { props, body, title, tags, links: [...links] }
}

/** "docs/decisions/0001-stack.md" → "0001-stack". */
export function noteName(rel: string): string {
  return rel.replace(/^.*\//, '').replace(/\.md$/i, '')
}

/**
 * Which note a link points to, as a vault-relative path (forward slashes), or null.
 * Relative paths ("../setup.md") resolve from the linking note's folder. Names ("setup",
 * "decisions/0001-stack") match the end of a note's path, case-insensitively; with several
 * matches the one nearest the linking note wins, then the shortest path.
 */
export function resolveLink(target: string, fromRel: string, rels: string[]): string | null {
  const t = target.trim().replace(/\\/g, '/')
  if (!t) return null
  const fromDir = fromRel.includes('/') ? fromRel.replace(/\/[^/]*$/, '') : ''
  const lower = new Map(rels.map((r) => [r.toLowerCase(), r]))
  if (/\.md$/i.test(t) && (t.startsWith('.') || t.includes('/'))) {
    const joined = normalize(t.startsWith('/') ? t.slice(1) : fromDir ? `${fromDir}/${t}` : t)
    const hit = lower.get(joined.toLowerCase()) ?? lower.get(normalize(t.replace(/^\//, '')).toLowerCase())
    if (hit) return hit
  }
  const want = t.toLowerCase().replace(/\.md$/, '')
  const matches = rels.filter((r) => {
    const l = r.toLowerCase().replace(/\.md$/, '')
    return l === want || l.endsWith(`/${want}`)
  })
  if (!matches.length) return null
  const shared = (r: string) => {
    const a = r.split('/').slice(0, -1)
    const b = fromDir ? fromDir.split('/') : []
    let i = 0
    while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++
    return i
  }
  return matches.sort((a, b) => shared(b) - shared(a) || a.length - b.length)[0]
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Turns [[wikilinks]] into Markdown links with an mc-note: URL, so a Markdown renderer can show them. */
export function wikilinksToMarkdown(body: string): string {
  // Leave code blocks and inline code alone.
  return body.replace(/(```[\s\S]*?```|`[^`\n]*`)|\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (all, code, target, _anchor, alias) => {
    if (code) return code
    const label = (alias ?? target).trim().replace(/[[\]]/g, '')
    return `[${label}](mc-note:${encodeURIComponent(target.trim())})`
  })
}

/** Headings for the outline: level, text and a slug the renderer uses as the element id. */
export function headings(body: string): { level: number; text: string; slug: string }[] {
  const out: { level: number; text: string; slug: string }[] = []
  const seen = new Map<string, number>()
  for (const m of body.replace(/```[\s\S]*?```/g, '').matchAll(/^(#{1,4})\s+(.+?)\s*#*\s*$/gm)) {
    const text = m[2].replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_a, t, al) => al ?? t).replace(/[*_`]/g, '')
    const base = slugify(text)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    out.push({ level: m[1].length, text, slug: n ? `${base}-${n}` : base })
  }
  return out
}

export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
}

/** Prompt for "Build vault": Claude reads the project and writes the docs vault. */
export function buildVaultPrompt(today: string): string {
  return `Set up this project's documentation vault in docs/ so that any future Claude session, and the project's owner, can understand the project quickly and work on it safely.

First read: the code (structure, entry points, key modules), README.md, CLAUDE.md, package/build files, and everything already in docs/ (including docs/briefings/, the newest session briefings, and docs/decisions/).

Then create or refresh these notes (Obsidian-style Markdown):
- docs/INDEX.md: the hub. One short paragraph on what the project is, then a map of every note in the vault with one line each, as [[wikilinks]]. Include existing notes you didn't write.
- docs/overview.md: purpose, who it's for, main features, tech stack.
- docs/architecture.md: how it's structured, the main modules and files and how they talk to each other, data flow. Mention files by relative path.
- docs/setup.md: how to install, run, build, test and release, with exact commands.
- docs/conventions.md: code style, patterns, rules to follow, and gotchas.
- docs/status.md: where things stand: what's done, in progress, known problems, next steps (use the newest briefings and the git history if you can read it).
- docs/glossary.md: project-specific terms, only if there are some.
- docs/decisions/: keep what's there; add a short ADR (NNNN-title.md) only for important decisions you find clear evidence for.

Rules:
- Every note you write starts with YAML frontmatter: title, tags (a list), updated: ${today}, generated: claude.
- Link notes to each other with [[note-name]] wikilinks wherever it helps, and link every note back to [[INDEX]].
- Only state what the code and docs show; mark anything you infer as "(unverified)". Be concise and scannable: headings, short bullets, tables where they help. No filler.
- Never delete notes, and don't rewrite notes that lack "generated: claude" in their frontmatter (you may link to them).
- Don't change source code, and don't touch files in docs/briefings/.
- Finally, make sure CLAUDE.md has a section "## Project docs" that says: "Start with docs/INDEX.md: it links to the overview, architecture, setup, conventions and current status. When you change something a note describes, update that note." Create CLAUDE.md if it's missing; change nothing else in it.

When you're done, reply with the list of notes you created or changed.`
}

/** Prompt for "Update vault": bring the notes up to date with what changed since they were written. */
export function updateVaultPrompt(today: string, since: string): string {
  return `Bring this project's documentation vault (docs/INDEX.md and the notes it links) up to date. The notes were last updated around ${since}.

Find what changed since then: the newest files in docs/briefings/, the git history if you can read it, and the code areas they mention. Then:
- Always refresh docs/status.md (done, in progress, problems, next steps).
- Update other notes only where they're now wrong or missing something important; add a note (and list it in docs/INDEX.md) only for a genuinely new area.
- Set "updated: ${today}" in the frontmatter of every note you change.

Same rules as before: keep frontmatter (title, tags, updated, generated: claude), link with [[wikilinks]] and back to [[INDEX]], only state what the code and docs show, mark guesses "(unverified)", never delete notes, don't rewrite notes without "generated: claude", don't change source code or docs/briefings/. Keep the "## Project docs" section in CLAUDE.md.

Be economical: read only what you need. When you're done, reply with the list of notes you changed.`
}
