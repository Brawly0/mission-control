import { createInterface } from 'node:readline'
import type { AgentEvent } from './agents'
import type { Side } from './plan'

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)

export const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  claude: paint('38;5;173'),
  codex: paint('38;5;75'),
  mc: paint('38;5;141')
}

const width = () => Math.max(60, Math.min(process.stdout.columns || 100, 160))

export function tag(side: Side | 'mc'): string {
  const label = side === 'mc' ? 'mc' : side
  return c[side](c.bold(label.padEnd(6)))
}

/** One progress line under an agent's tag, cut to the terminal width. */
export function agentLine(side: Side, phase: string, e: AgentEvent): void {
  const icon = e.kind === 'tool' ? '›' : e.kind === 'error' ? '✗' : e.kind === 'info' ? '·' : '“'
  const prefix = `${tag(side)} ${c.dim(phase.padEnd(6))} ${icon} `
  const room = width() - 18
  const body = e.text.length > room ? e.text.slice(0, room - 1) + '…' : e.text
  const line = e.kind === 'error' ? c.red(body) : e.kind === 'text' ? body : c.dim(body)
  console.log(prefix + line)
}

export function say(text: string): void {
  console.log(`${tag('mc')} ${text}`)
}

export function heading(text: string): void {
  console.log('\n' + c.mc(c.bold(`── ${text} `)) + c.mc('─'.repeat(Math.max(4, width() - text.length - 5))))
}

export function block(text: string, indent = '   '): void {
  for (const line of text.split(/\r?\n/)) console.log(indent + line)
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ''
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // Ctrl+C at a prompt quits like it does during a run (readline would otherwise just pause).
  rl.on('SIGINT', () => { rl.close(); process.emit('SIGINT') })
  try {
    return await new Promise<string>(resolve => rl.question(question, resolve))
  } finally {
    rl.close()
  }
}
