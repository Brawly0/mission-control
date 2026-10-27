import type { TaskEvent } from './types'

/**
 * Turns the JSON lines of a background task (`claude -p --output-format stream-json` or
 * `codex exec --json`) into terminal text that reads like the CLI itself, for the live task
 * terminals. Pure (no Electron, no I/O) so it can be unit-tested with recorded events.
 */

const RESET = '\x1b[0m'
const DIM = '\x1b[90m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'

/** Lines of a tool's output shown under the call, like the CLI's collapsed view. */
const RESULT_LINES = 6

/** xterm needs CRLF; keeps the text's own lines. */
function lines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

function block(text: string, color = ''): string {
  return lines(text.trimEnd()).map((l) => `${color}${l}${color ? RESET : ''}\r\n`).join('')
}

/** "  ⎿  first lines … +N lines", dimmed. */
export function toolOutput(text: string, error = false): string {
  const all = lines(text.trimEnd()).filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1))
  if (!all.length) return `${DIM}  ⎿  (no output)${RESET}\r\n`
  const shown = all.slice(0, RESULT_LINES)
  const color = error ? RED : DIM
  const out = shown.map((l, i) => `${color}${i === 0 ? '  ⎿  ' : '     '}${l.slice(0, 240)}${RESET}\r\n`).join('')
  return all.length > shown.length ? out + `${DIM}     … +${all.length - shown.length} lines${RESET}\r\n` : out
}

/** The CLI's "Name(argument)" header for a tool call. */
export function toolCall(name: string, input: any): string {
  const arg = (() => {
    if (!input || typeof input !== 'object') return ''
    const v = input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt
    if (typeof v === 'string') return v.split('\n')[0]
    if (name === 'TodoWrite' && Array.isArray(input.todos)) return `${input.todos.length} items`
    return ''
  })()
  return `${GREEN}●${RESET} ${BOLD}${name}${RESET}${arg ? `(${arg.slice(0, 200)})` : ''}\r\n`
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : c?.type === 'image' ? '[image]' : '')).join('\n')
  return ''
}

/** One Claude stream-json event as terminal text ('' when it shows nothing). */
export function formatClaudeEvent(e: any): string {
  if (e?.type === 'system' && e.subtype === 'init') {
    return `${DIM}model ${e.model ?? 'default'} · permission mode ${e.permissionMode ?? '?'} · session ${e.session_id ?? '?'}${RESET}\r\n\r\n`
  }
  if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
    let out = ''
    for (const b of e.message.content) {
      if (b?.type === 'tool_use') out += toolCall(String(b.name ?? 'Tool'), b.input)
      else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) out += `${CYAN}●${RESET} ${block(b.text.trim()).replace(/\r\n(?!$)/g, '\r\n  ')}\r\n`
      else if (b?.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) out += block(`✻ ${b.thinking.trim().split('\n')[0].slice(0, 200)}`, DIM)
    }
    return out
  }
  if (e?.type === 'user' && Array.isArray(e.message?.content)) {
    return e.message.content
      .filter((b: any) => b?.type === 'tool_result')
      .map((b: any) => toolOutput(resultText(b.content), !!b.is_error) + '\r\n')
      .join('')
  }
  if (e && typeof e === 'object' && (e.type === 'result' || 'total_cost_usd' in e)) {
    const failed = e.is_error || (e.subtype && e.subtype !== 'success')
    const cost = Number(e.total_cost_usd ?? 0)
    const stats = [cost ? `$${cost.toFixed(cost < 1 ? 3 : 2)}` : '', e.num_turns ? `${e.num_turns} turns` : '', e.duration_ms ? `${Math.round(Number(e.duration_ms) / 1000)}s` : ''].filter(Boolean).join(' · ')
    return failed
      ? `${RED}✗ ${typeof e.result === 'string' && e.result ? e.result.split('\n')[0] : `Ended: ${e.subtype ?? 'error'}`}${RESET}${stats ? ` ${DIM}${stats}${RESET}` : ''}\r\n`
      : `${GREEN}✓ Done${RESET}${stats ? ` ${DIM}${stats}${RESET}` : ''}\r\n`
  }
  return ''
}

/** One `codex exec --json` event as terminal text ('' when it shows nothing). */
export function formatCodexEvent(e: any): string {
  if (e?.type === 'thread.started') return `${DIM}session ${e.thread_id ?? '?'}${RESET}\r\n\r\n`
  const item = e?.item
  if (e?.type === 'item.started' && item?.type === 'command_execution') return toolCall('Run', { command: item.command })
  if (e?.type === 'item.started' && item?.type === 'mcp_tool_call') return toolCall(`${item.server ?? 'mcp'}.${item.tool ?? 'tool'}`, item.arguments)
  if (e?.type === 'item.started' && item?.type === 'web_search') return toolCall('WebSearch', { query: item.query })
  if (e?.type === 'item.completed') {
    if (item?.type === 'command_execution') {
      const code = item.exit_code
      return toolOutput(String(item.aggregated_output ?? ''), !!code) + (code ? `${RED}     exit ${code}${RESET}\r\n` : '') + '\r\n'
    }
    if (item?.type === 'file_change' && Array.isArray(item.changes)) {
      return item.changes.map((c: any) => toolCall(c?.kind === 'add' ? 'Write' : c?.kind === 'delete' ? 'Delete' : 'Edit', { file_path: c?.path })).join('') + '\r\n'
    }
    if (item?.type === 'agent_message' && item.text) return `${CYAN}●${RESET} ${block(String(item.text).trim()).replace(/\r\n(?!$)/g, '\r\n  ')}\r\n`
    if (item?.type === 'reasoning' && item.text) return block(`✻ ${String(item.text).trim().split('\n')[0].slice(0, 200)}`, DIM)
  }
  if (e?.type === 'error' || e?.type === 'turn.failed') return `${RED}✗ ${String(e.message ?? e.error?.message ?? 'Codex task failed')}${RESET}\r\n`
  if (e?.type === 'turn.completed') {
    const u = e.usage
    return `${GREEN}✓ Done${RESET}${u ? ` ${DIM}${Number(u.input_tokens ?? 0).toLocaleString('en-US')} in · ${Number(u.output_tokens ?? 0).toLocaleString('en-US')} out${RESET}` : ''}\r\n`
  }
  return ''
}

/** The command line shown first, like a shell prompt. */
export function formatStart(cwd: string, command: string): string {
  return `${DIM}${cwd}${RESET}\r\n${YELLOW}❯${RESET} ${command}\r\n\r\n`
}

export function formatNote(text: string, tone: 'dim' | 'error' | 'ok' = 'dim'): string {
  return block(text, tone === 'error' ? RED : tone === 'ok' ? GREEN : DIM)
}

/** A run from before this app session has no live output; rebuild a readable log from its saved events. */
export function formatEvents(events: TaskEvent[]): string {
  if (!events.length) return ''
  let out = formatNote('Saved activity (live output is kept while Mission Control is open)') + '\r\n'
  for (const ev of events) {
    if (ev.kind === 'tool') out += `${GREEN}●${RESET} ${ev.text}\r\n`
    else if (ev.kind === 'text') out += `${CYAN}●${RESET} ${block(ev.text).replace(/\r\n(?!$)/g, '\r\n  ')}\r\n`
    else if (ev.kind === 'result') out += `${GREEN}✓${RESET} ${block(ev.text.split('\n')[0])}`
    else if (ev.kind === 'error') out += formatNote(`✗ ${ev.text}`, 'error')
    else out += formatNote(ev.text)
  }
  return out
}
