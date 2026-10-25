// Pure helpers that give projects and chats readable names and icons.

/** Icons a project can use. The keys are lucide-react component names (mapped in the renderer). */
export const PROJECT_ICONS = [
  'Folder', 'Gamepad2', 'Swords', 'ChartCandlestick', 'TrendingUp', 'NotebookPen', 'Bot', 'Brain', 'Sparkles',
  'GraduationCap', 'Network', 'Globe', 'Code', 'Terminal', 'Server', 'Database', 'Smartphone', 'Cpu', 'Gavel',
  'Briefcase', 'BookOpen', 'PenLine', 'Palette', 'Film', 'Music', 'Camera', 'FlaskConical', 'Wrench', 'Rocket',
  'Shield', 'HardDrive', 'House'
] as const
export type ProjectIcon = (typeof PROJECT_ICONS)[number]

/** Hues offered in the icon picker (HSL hue degrees). */
export const PROJECT_HUES = [210, 175, 140, 95, 45, 25, 0, 330, 290, 255] as const

/** Keyword rules, checked in order; the first match wins. */
const ICON_RULES: [RegExp, ProjectIcon][] = [
  [/\b(unity|godot|unreal|game|gameplay|player|multiplayer|playtest|zomboid|minecraft|terraria|modding|mods?)\b/i, 'Gamepad2'],
  [/\b(journal|diary)\b/i, 'NotebookPen'],
  [/\b(trading|trader|trades?|markets?|stocks?|forex|crypto|candles?|backtest|tradingview|pine)\b/i, 'ChartCandlestick'],
  [/\b(bot|telegram|discord|automation)\b/i, 'Bot'],
  [/\b(course|semester|university|assignment|homework|student|exam|lecture|[A-Z]{3,4}\d{3,4})\b/, 'GraduationCap'],
  [/\b(socket|network|tcp|udp|server|client)\b/i, 'Network'],
  // Not "claude": every CLAUDE.md mentions it.
  [/\b(ai|llm|machine learning|neural|model|agents?)\b/i, 'Brain'],
  [/\b(website|frontend|react|next\.?js|vite|html|css)\b/i, 'Globe'],
  [/\b(android|ios|mobile|flutter)\b/i, 'Smartphone']
]

/** Picks an icon from what a project's folder name and README say about it. */
export function guessIcon(folderName: string, readme: string, path = ''): ProjectIcon {
  if (/^[a-z]:\\?$/i.test(path.trim())) return 'HardDrive'
  // The folder's own name says the most ("bot").
  const folder = folderName.replace(/[-_]+/g, ' ')
  for (const [re, icon] of ICON_RULES) if (re.test(folder)) return icon
  // Then the README's title ("WBP · Journal & Intel"), which says what the project is.
  const text = readme.slice(0, 3000)
  const title = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  for (const [re, icon] of ICON_RULES) if (re.test(title)) return icon
  // Then the kind the README mentions most, so a passing word ("…icons (game, journal…)") doesn't
  // decide it. Ties go to the earlier rule.
  let best: { icon: ProjectIcon; score: number } | null = null
  for (const [re, icon] of ICON_RULES) {
    const score = text.match(new RegExp(re.source, re.flags + 'g'))?.length ?? 0
    if (score > (best?.score ?? 0)) best = { icon, score }
  }
  return best?.icon ?? 'Folder'
}

/** Cleans Markdown out of a one-line heading. */
function plain(line: string): string {
  return line
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
}

/** ALL CAPS words read like shouting in a list; "CASE CLOSED" becomes "Case Closed". Short acronyms stay. */
function calmCaps(s: string): string {
  if (!/[A-Z]{5,}/.test(s) || /[a-z]/.test(s)) return s
  return s.replace(/\p{L}+/gu, (w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()))
}

/**
 * Reads a project's title and one-line description from its README text.
 * Returns empty strings when the README has nothing useful.
 */
export function readmeInfo(text: string, folderName: string): { title: string; description: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let i = lines.findIndex((l) => l.trim())
  if (i < 0) return { title: '', description: '' }
  let heading = lines[i].trim()
  // "Title\n=====" style heading, or a "# Title" one. A plain first line counts too (README.txt).
  heading = heading.replace(/^#{1,6}\s+/, '')
  if (/^[=-]{3,}$/.test(lines[i + 1]?.trim() ?? '')) i++
  let title = plain(heading)
  // "bot — map of this folder": keep the part before a long dash.
  title = title.split(/\s+[—–]\s+/)[0]
  // "Course - Project 1 (Socket Programming)": drop trailing parentheses when the title is long.
  if (title.length > 32) title = title.replace(/\s*\([^)]*\)\s*$/, '')
  title = calmCaps(title).slice(0, 48).trim()
  if (title.length < 2) title = ''

  let description = ''
  let inCode = false
  for (let j = i + 1; j < lines.length && j < i + 25; j++) {
    const l = lines[j].trim()
    if (l.startsWith('```')) {
      inCode = !inCode
      if (description) break
      continue
    }
    if (inCode) continue
    if (!l) {
      if (description) break
      continue
    }
    if (/^(#|```|[-*+] |\||>|<|!\[|\d+\. )/.test(l) || /^[=-]{3,}$/.test(l)) {
      if (description) break
      continue
    }
    description += (description ? ' ' : '') + plain(l)
  }
  if (description.length > 160) description = description.slice(0, 157).replace(/\s+\S*$/, '') + '…'
  if (title.toLowerCase() === folderName.toLowerCase()) title = folderName
  return { title, description }
}

/** Friendly name for a project folder, e.g. "C:\" becomes "C: drive". */
export function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (/^[a-z]:$/i.test(trimmed)) return `${trimmed.toUpperCase()} drive`
  return trimmed.split(/[\\/]/).pop() || path
}

/** For a path inside a Claude Code worktree, the main project folder and the worktree's name. */
export function worktreeParent(path: string): { parent: string; name: string } | null {
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/i.exec(path)
  return m ? { parent: m[1], name: m[2] } : null
}

/** "semester-schedule-planning-2b8af2" -> "semester schedule planning". */
export function prettyWorktreeName(name: string): string {
  return name
    .replace(/-[0-9a-f]{4,8}$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

/** Claude Code's own folder name for a working directory: every character that isn't a letter or digit becomes "-". */
export function encodeProjectKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Turns a first prompt into a short chat title, dropping pasted noise like paths, code and greetings. */
export function titleFromPrompt(prompt: string): string {
  const lines = prompt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(```|<|>)/.test(l))
  let t = lines[0] ?? ''
  // A chat that starts from a briefing is named after the briefing's file.
  const brief = /\b(?:briefing|brief|handoff)\b[^"'\n]*?["']?([a-z]:[\\/][^"'\n]+?\.md)\b/i.exec(t) ?? /["']?([a-z]:[\\/][^"'\n]*?(?:brief|handoff)[^"'\n\\/]*\.md)\b/i.exec(t)
  if (brief) {
    const name = briefingName(brief[1])
    if (name) return `From briefing: ${name}`
  }
  // Paths become their last part: "fix C:\app\src\login.ts" reads "fix login.ts".
  t = t.replace(/["']?\b[a-z]:[\\/][^"'\s]*["']?/gi, (p) => p.replace(/["']/g, '').split(/[\\/]/).filter(Boolean).pop() ?? p)
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^(?:(?:hi|hey|hello|yo|ok(?:ay)?|so|alright|please|pls|claude|now)\b[\s,!.:-]*)+/i, '')
    t = t.replace(/^(?:i (?:want|need|would like) (?:you )?to|i want|can you|could you|would you|will you|help me(?: to)?|let'?s|we need to|i have (?:a |some )?questions?(?: about)?|quick question[,:]?)\s+/i, '')
  }
  t = t.replace(/\s+/g, ' ').replace(/[\s,;:]+$/, '').trim()
  if (t.length > 72) t = t.slice(0, 69).replace(/\s+\S*$/, '') + '…'
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

/**
 * Titles that don't say what a chat was about: handoff names ("Next task briefing", "Session
 * Briefing 2026-10-11"), "continue…", a bare date or a single word. Such chats are offered for
 * naming by Claude, like chats titled after their first prompt.
 */
export function unclearTitle(title: string): boolean {
  const t = title.trim().toLowerCase()
  if (!t || t === '(empty session)') return false
  return (
    /^(?:session briefing|next task|new session|continue|continued|start here|read (?:the )?(?:session )?briefing|from briefing|briefing|handoff|untitled|quick chat|hi|hello|test)\b/.test(t) ||
    /^\W*\d{4}-\d{2}-\d{2}\W*$/.test(t) ||
    !/\s/.test(t)
  )
}

/** "C:\app\docs\briefings\2026-10-24-1449-mission-control-v0-12.md" → "Mission control v0 12". */
export function briefingName(file: string): string {
  let n = file.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? ''
  n = n.replace(/^\d{4}-\d{2}-\d{2}(?:[-_]\d{4})?[-_]?/, '').replace(/[-_]+/g, ' ').trim()
  return n ? n[0].toUpperCase() + n.slice(1) : ''
}

// ---------------------------------------------------------------- which project a chat worked on

/** "/c/Users/me", "C:/Users/me/" and "C:\Users\me" all become "C:\Users\me". '' for anything that isn't an absolute Windows path. */
export function windowsPath(raw: string): string {
  let p = raw.trim()
  const bash = /^\/([a-z])(\/|$)(.*)$/i.exec(p)
  if (bash) p = `${bash[1].toUpperCase()}:\\${bash[3]}`
  if (!/^[a-z]:[\\/]/i.test(p) && !/^[a-z]:$/i.test(p)) return ''
  p = p.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
  p = p[0].toUpperCase() + p.slice(1)
  return p.length > 3 ? p.replace(/\\+$/, '') : p.replace(/^([A-Z]):\\?$/, '$1:\\')
}

/** Folders that hold projects rather than being one, when they have no project files of their own. */
const CONTAINER_NAMES = /^(desktop|documents|downloads|onedrive.*|projects?|repos|source|code|dev|github|workspaces?|work)$/i
/** Temp folders and Claude Desktop's scratch space, including the Temp folder itself. */
const SCRATCH = /[\\/](AppData[\\/]Local[\\/]Temp|scratch-workspaces)([\\/]|$)/i
/** True for a throwaway folder: chats started there are hidden as scratch and left out of project counts. */
export function isScratchPath(path: string): boolean {
  return SCRATCH.test(path)
}

/** Folders whose files never make a chat "about" a project: Claude's own data, temp, Windows. */
const SKIP = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)|\\appdata(\\|$)|\\\.claude(\\|$)|\\\$recycle\.bin(\\|$)/i

/**
 * The project folder a path belongs to: the first folder on the way down from the drive that isn't
 * a container (drive root, home, Desktop, Projects…). `hasMarker` says whether a folder has project
 * files (.git, package.json, README…); a container name with them counts as a project.
 */
export function projectRootOf(path: string, home: string, hasMarker: (dir: string) => boolean): string | null {
  const p = windowsPath(path)
  if (!p || SKIP.test(p)) return null
  const parts = p.replace(/\\$/, '').split('\\')
  const homeLc = windowsPath(home).toLowerCase()
  let cur = parts[0]
  for (let i = 1; i < parts.length; i++) {
    cur = `${cur}\\${parts[i]}`
    const lc = cur.toLowerCase()
    if (homeLc.startsWith(lc + '\\') || lc === homeLc) continue
    if (CONTAINER_NAMES.test(parts[i]) && !hasMarker(cur)) continue
    return cur
  }
  return null
}

/** True when `child` is strictly inside `parent`. */
export function isInside(child: string, parent: string): boolean {
  const c = child.toLowerCase().replace(/\\+$/, '')
  const p = parent.toLowerCase().replace(/\\+$/, '')
  return c.startsWith(p.endsWith('\\') ? p : p + '\\') && c !== p
}

/**
 * For a chat started in a parent folder (like C:\ or Desktop), or in a scratch or temp folder, the
 * project it mostly worked in: the root with the most hits, if it has at least 5 and at least 60% of
 * all of them. Otherwise null.
 */
export function pickProject(folders: { folder: string; hits: number }[], cwd: string, rootOf: (folder: string) => string | null): string | null {
  // A chat started in Claude Desktop's scratch space or a temp folder can belong to any project.
  const anywhere = SKIP.test(windowsPath(cwd))
  const byRoot = new Map<string, { root: string; hits: number }>()
  let total = 0
  for (const f of folders) {
    const root = rootOf(f.folder)
    if (!root) continue
    total += f.hits
    if (!anywhere && !isInside(root, cwd)) continue
    const cur = byRoot.get(root.toLowerCase())
    if (cur) cur.hits += f.hits
    else byRoot.set(root.toLowerCase(), { root, hits: f.hits })
  }
  const best = [...byRoot.values()].sort((a, b) => b.hits - a.hits)[0]
  return best && best.hits >= 5 && best.hits >= total * 0.6 ? best.root : null
}

// ---------------------------------------------------------------- session briefings

/** The compaction summary without Claude Code's wrapper lines (the intro, tool list and "continue" instructions). */
export function cleanBriefing(text: string): string {
  return text
    .replace(/<[a-z-]+-authored-by-others\s*\/>\s*/g, '')
    .replace(/\s*This session is being continued from a previous conversation that ran out of context\.( The summary below covers the earlier portion of the conversation\.)?\s*/, '\n\n')
    .replace(/<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>\s*/g, '')
    .replace(/\n*Continue the conversation from where it left off[\s\S]*$/, '')
    .replace(/\n*If you need specific details from before compaction[^\n]*\n?/, '\n')
    .trim()
}

/** "2026-10-24-1405-project-organization-tool.md" */
export function briefingFileName(at: number, title: string): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'session'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${slug}.md`
}

/** The briefing file: a header the next session can act on, then the summary. */
export function briefingMarkdown(b: { title: string; at: number; trigger: string; preTokens: number; sessionId: string; projectName: string; transcript?: string; text: string }): string {
  const when = new Date(b.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  const how = b.trigger === 'manual' ? 'compacted with /compact' : b.trigger === 'auto' ? 'the chat reached its limit' : 'compacted'
  const size = b.preTokens ? ` at about ${Math.round(b.preTokens / 1000)}K tokens` : ''
  return [
    `# Session briefing: ${b.title || 'Untitled chat'}`,
    '',
    `${when} · ${b.projectName} · ${how}${size}. Saved by Mission Control.`,
    '',
    `To pick up where it left off, start a new chat and ask Claude to read this file. To reopen the original chat instead: \`claude --resume ${b.sessionId}\`${b.transcript ? ` (full transcript: \`${b.transcript}\`)` : ''}.`,
    '',
    '---',
    '',
    cleanBriefing(b.text),
    ''
  ].join('\n')
}

/** What a new session is told when it starts from a briefing. */
export function briefingPrompt(path: string): string {
  return `Read the session briefing at "${path}". It's the handoff from the previous session on this project. Then tell me in a few lines where things stand and what you'd do next, and wait for my go-ahead.`
}

/** What "Write briefing" types into a running agent, for a handoff before the chat runs out of room. */
export function writeBriefingPrompt(file: string): string {
  return `Write a session briefing for the next session to ${file}: the goal, what's done and verified, decisions and why, open problems, the exact next steps, gotchas, and the files that matter. Keep it skimmable. Then tell me the path.`
}

/** Added to a project's CLAUDE.md so the summary Claude writes when a chat runs out of room is a proper handoff. */
export const COMPACT_INSTRUCTIONS = `## Summary instructions

When you compact this conversation, write the summary as a session briefing for whoever picks this up next:
the goal; what's done and verified (and what isn't); decisions made and why; open problems; the exact next
steps; gotchas; and the files that matter.
`
