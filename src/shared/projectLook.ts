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
  [/\b(ai|llm|machine learning|neural|model|agents?|claude)\b/i, 'Brain'],
  [/\b(website|frontend|react|next\.?js|vite|html|css)\b/i, 'Globe'],
  [/\b(android|ios|mobile|flutter)\b/i, 'Smartphone']
]

/** Picks an icon from what a project's folder name and README say about it. */
export function guessIcon(folderName: string, readme: string, path = ''): ProjectIcon {
  if (/^[a-z]:\\?$/i.test(path.trim())) return 'HardDrive'
  // The folder's own name says the most ("bot"), then the README.
  for (const text of [folderName.replace(/[-_]+/g, ' '), readme.slice(0, 3000)]) {
    for (const [re, icon] of ICON_RULES) if (re.test(text)) return icon
  }
  return 'Folder'
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
  t = t.replace(/^(?:(?:hi|hey|hello|ok(?:ay)?|so|please|pls)\b[\s,!.]*)+/i, '')
  t = t.replace(/\s+/g, ' ').trim()
  if (t.length > 80) t = t.slice(0, 77).replace(/\s+\S*$/, '') + '…'
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}
