/** Slash commands typed at the interactive `mc ›` prompt. Pure, so they're unit-tested. */

export interface Command {
  name: string
  args: string
  usage: string
  help: string
}

export const COMMANDS: Array<Omit<Command, 'args'> & { takesArgs?: boolean }> = [
  { name: 'help', usage: '/help', help: 'commands and options' },
  { name: 'clear', usage: '/clear', help: 'clear the screen' },
  { name: 'usage', usage: '/usage', help: 'session spend, agent calls and last run' },
  { name: 'model', usage: '/model claude|codex <name|default>', takesArgs: true, help: "show current models or set one agent's model" },
  { name: 'mode', usage: '/mode auto|split|claude|codex', takesArgs: true, help: 'auto: mc answers, gives it to one agent or splits it · split: always both · claude/codex: that one builds alone' },
  { name: 'new', usage: '/new', help: 'start fresh without earlier request context' },
  { name: 'status', usage: '/status', help: 'current settings' },
  { name: 'list', usage: '/list', help: 'runs in this repository' },
  { name: 'merge', usage: '/merge [id]', takesArgs: true, help: 'merge a finished run into your branch (default: the latest)' },
  { name: 'clean', usage: '/clean [id]', takesArgs: true, help: 'throw a run away (worktree and branch)' },
  { name: 'review', usage: '/review on|off', takesArgs: true, help: 'the other agent reviews the diff after building' },
  { name: 'full', usage: '/full on|off', takesArgs: true, help: 'let both agents run any command' },
  { name: 'planner', usage: '/planner claude|codex', takesArgs: true, help: 'who splits the work' },
  { name: 'aura', usage: '/aura <name>', takesArgs: true, help: 'colour of the live work tree: mood (follows the work), violet, ocean, sunset, matrix, gold, ice, fire, rainbow · saved' },
  { name: 'view', usage: '/view tree|lines', takesArgs: true, help: 'animated work tree, or one status line per agent · saved' },
  { name: 'report', usage: '/report', help: 'everything the agents said in the last run' },
  { name: 'chats', usage: '/chats [n]', takesArgs: true, help: "this project's Claude and Codex chats · /chats <n> shows the end of one" },
  { name: 'history', usage: '/history [clear]', takesArgs: true, help: "mc's own history in this repo (kept between sessions) · clear wipes it" },
  { name: 'brief', usage: '/brief', help: 'write a session briefing to docs/briefings/ and show its path' },
  { name: 'context', usage: '/context', help: "each agent's context window, and what history and chats add to the plan" },
  { name: 'version', usage: '/version', help: 'show the mc version' },
  { name: 'exit', usage: '/exit', help: 'quit mc' }
]

const ALIASES: Record<string, string> = { quit: 'exit', q: 'exit', '?': 'help', h: 'help', ls: 'list', settings: 'status', team: 'mode', cost: 'usage', cls: 'clear', reset: 'new', hist: 'history', chat: 'chats', briefing: 'brief', ctx: 'context' }

/** "/merge ab12" → { name: 'merge', args: 'ab12' }. Plain "help", "list" and "exit" work without the slash. */
export function parseCommand(input: string): Command | { name: 'unknown'; args: string } | null {
  const line = input.trim()
  const bare = /^(help|\?|list|exit|quit|q)$/i.exec(line)
  if (!line.startsWith('/') && !bare) return null
  const m = /^\/?(\S+)\s*([\s\S]*)$/.exec(line)!
  const word = m[1].toLowerCase()
  const name = ALIASES[word] ?? word
  const found = COMMANDS.find(c => c.name === name)
  if (!found) return { name: 'unknown', args: word }
  return { ...found, args: m[2].trim() }
}

/** on/off/true/false/yes/no; anything else (including nothing) toggles. */
export function onOff(arg: string, current: boolean): boolean {
  if (/^(on|true|yes|1)$/i.test(arg)) return true
  if (/^(off|false|no|0)$/i.test(arg)) return false
  return !current
}

export interface Suggestion { value: string; label: string; help: string }

/** Shared values for the live menu and readline. Free-text arguments still work. */
const VALUES: Record<string, string[]> = {
  aura: ['mood', 'violet', 'ocean', 'sunset', 'matrix', 'gold', 'ice', 'fire', 'rainbow'],
  view: ['tree', 'lines'], mode: ['auto', 'split', 'claude', 'codex'],
  planner: ['claude', 'codex'], model: ['claude', 'codex'], review: ['on', 'off'], full: ['on', 'off'], history: ['clear'],
  'model claude': ['default', 'opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'],
  // Codex is not on PATH here; this model is confirmed by the local Codex config.
  'model codex': ['default', 'gpt-6-astra']
}

/** A short line per value, so the menu doesn't repeat the command's whole help on every row. */
const VALUE_HELP: Record<string, string> = {
  'mode auto': 'mc decides: answer, one agent, or both',
  'mode split': 'always split between Claude and Codex',
  'mode claude': 'Claude builds alone, Codex reviews',
  'mode codex': 'Codex builds alone, Claude reviews',
  'planner claude': 'Claude reads the repo and plans',
  'planner codex': 'Codex reads the repo and plans',
  'model claude': "pick Claude's model",
  'model codex': "pick Codex's model",
  'view tree': 'animated work tree',
  'view lines': 'one status line per agent',
  'review on': 'the other agent checks the diff',
  'review off': 'skip the review (faster, cheaper)',
  'full on': 'both agents may run any command',
  'full off': 'edits plus safe commands only',
  'aura mood': 'colour follows the work',
  'history clear': "forget mc's history in this repo"
}

export function suggestions(line: string): Suggestion[] {
  if (!line.startsWith('/')) return []
  if (!/\s/.test(line)) {
    return COMMANDS.filter(cmd => cmd.name.startsWith(line.slice(1).toLowerCase())).map(cmd => ({
      value: '/' + cmd.name + (cmd.takesArgs ? ' ' : ''), label: '/' + cmd.name, help: cmd.help
    }))
  }
  const match = /^\/(\S+)\s+([\s\S]*)$/.exec(line)
  if (!match) return []
  const name = ALIASES[match[1].toLowerCase()] ?? match[1].toLowerCase()
  const words = match[2].toLowerCase().split(/\s+/)
  const prefix = words.pop()!
  const key = [name, ...words].join(' ')
  return (VALUES[key] ?? []).filter(value => value.startsWith(prefix) ||
    (key === 'model claude' && value.replace(/^claude-/, '').startsWith(prefix))).map(value => ({
      value: '/' + key + ' ' + value + (key === 'model' ? ' ' : ''), label: value,
      help: key.startsWith('model ') ? (value === 'default' ? 'use the CLI default model' : words[0] + ' model') : VALUE_HELP[`${key} ${value}`] ?? (key === 'aura' ? 'live tree colour' : '')
    }))
}

/** Keep readline's completion shape, using the same candidates as the live menu. */
export function complete(line: string): [string[], string] {
  return [suggestions(line).map(item => item.value.trimEnd()), line]
}
