/** Slash commands typed at the interactive `mc ›` prompt. Pure, so they're unit-tested. */

export interface Command {
  name: string
  args: string
  usage: string
  help: string
}

export const COMMANDS: Array<Omit<Command, 'args'>> = [
  { name: 'help', usage: '/help', help: 'commands and options' },
  { name: 'list', usage: '/list', help: 'runs in this repository' },
  { name: 'merge', usage: '/merge [id]', help: 'merge a finished run into your branch (default: the latest)' },
  { name: 'clean', usage: '/clean [id]', help: 'throw a run away (worktree and branch)' },
  { name: 'mode', usage: '/mode auto|split|claude|codex', help: 'auto: mc answers, gives it to one agent or splits it · split: always both · claude/codex: that one builds alone' },
  { name: 'review', usage: '/review on|off', help: 'the other agent reviews the diff after building' },
  { name: 'full', usage: '/full on|off', help: 'let both agents run any command' },
  { name: 'yes', usage: '/yes on|off', help: 'start building without confirming the plan' },
  { name: 'planner', usage: '/planner claude|codex', help: 'who splits the work' },
  { name: 'model', usage: '/model claude|codex <name|default>', help: 'model for one agent' },
  { name: 'aura', usage: '/aura <name>', help: 'colour of the live work tree: mood (follows the work), violet, ocean, sunset, matrix, gold, ice, fire, rainbow · saved' },
  { name: 'view', usage: '/view tree|lines', help: 'animated work tree, or one status line per agent · saved' },
  { name: 'status', usage: '/status', help: 'current settings' },
  { name: 'clear', usage: '/clear', help: 'clear the screen' },
  { name: 'exit', usage: '/exit', help: 'quit mc' }
]

const ALIASES: Record<string, string> = { quit: 'exit', q: 'exit', '?': 'help', h: 'help', ls: 'list', settings: 'status', team: 'mode' }

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

/** Values Tab completes after a command. */
const VALUES: Record<string, string[]> = { aura: ['mood', 'violet', 'ocean', 'sunset', 'matrix', 'gold', 'ice', 'fire', 'rainbow'], view: ['tree', 'lines'], mode: ['auto', 'split', 'claude', 'codex'], planner: ['claude', 'codex'], model: ['claude', 'codex'], review: ['on', 'off'], full: ['on', 'off'], yes: ['on', 'off'] }

/** Tab completion for readline: slash commands, then their values. */
export function complete(line: string): [string[], string] {
  const arg = /^\/(\w+) (\w*)$/.exec(line)
  if (arg && VALUES[arg[1]]) return [VALUES[arg[1]].filter(v => v.startsWith(arg[2].toLowerCase())).map(v => `/${arg[1]} ${v}`), line]
  if (!line.startsWith('/') || /\s/.test(line)) return [[], line]
  const hits = COMMANDS.map(c => `/${c.name}`).filter(n => n.startsWith(line.toLowerCase()))
  return [hits, line]
}
