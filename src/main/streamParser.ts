import { basename } from 'node:path'
import type { RateLimitInfo, TaskEvent, TaskRun } from '../shared/types'

/**
 * Turns `claude -p --output-format stream-json` events into task progress. Pure (no Electron, no I/O)
 * so it can be unit-tested with recorded events.
 */

export const MAX_EVENTS = 200

export function addEvent(run: TaskRun, kind: TaskEvent['kind'], text: string, at = Date.now()): void {
  run.events.push({ at, kind, text: text.slice(0, 4000) })
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS)
}

/** A short, human description of a tool call for the card. */
export function describeTool(name: string, input: any): string {
  const file = (p: unknown) => (typeof p === 'string' ? basename(p.replace(/\\/g, '/')) : '')
  switch (name) {
    case 'Read':
      return `Reading ${file(input?.file_path)}`
    case 'Write':
      return `Writing ${file(input?.file_path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${file(input?.file_path ?? input?.notebook_path)}`
    case 'Bash':
    case 'PowerShell':
      return `Running: ${String(input?.command ?? '').split('\n')[0].slice(0, 90)}`
    case 'Glob':
    case 'Grep':
      return `Searching ${String(input?.pattern ?? '').slice(0, 60)}`
    case 'WebFetch':
      return `Reading ${String(input?.url ?? '').slice(0, 70)}`
    case 'WebSearch':
      return `Searching the web: ${String(input?.query ?? '').slice(0, 60)}`
    case 'Task':
    case 'Agent':
      return `Delegating: ${String(input?.description ?? '').slice(0, 70)}`
    case 'TodoWrite':
      return 'Updating its plan'
    default:
      return `Using ${name}`
  }
}

export interface StreamOutcome {
  /** True for the final `result` event. */
  final: boolean
  rateLimit?: RateLimitInfo
}

/** Applies one stream-json event to the run. `permission` is only used for the start message. */
export function applyStreamEvent(run: TaskRun, e: any, permission: string, now = Date.now()): StreamOutcome {
  if (e?.type === 'system' && e.subtype === 'init') {
    run.sessionId = e.session_id ?? run.sessionId
    addEvent(run, 'info', `Model ${e.model ?? 'default'}, permission mode ${e.permissionMode ?? permission}`, now)
    run.activity = 'Thinking…'
    return { final: false }
  }
  if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
    for (const block of e.message.content) {
      if (block?.type === 'tool_use') {
        run.toolCalls++
        run.activity = describeTool(block.name, block.input)
        addEvent(run, 'tool', run.activity, now)
      } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const text = block.text.trim()
        run.activity = text.split('\n')[0].slice(0, 140)
        addEvent(run, 'text', text, now)
      }
    }
    return { final: false }
  }
  if (e?.type === 'user' && Array.isArray(e.message?.content)) {
    run.activity = 'Thinking…'
    return { final: false }
  }
  if (e?.type === 'rate_limit_event' && e.rate_limit_info) {
    const info = e.rate_limit_info
    const windows = Object.entries(info.unifiedWindows ?? {}).map(([name, w]: [string, any]) => ({
      name,
      utilization: Number(w?.utilization ?? 0),
      resetsAt: Number(w?.resetsAt ?? 0) * 1000
    }))
    return { final: false, rateLimit: { at: now, status: String(info.status ?? ''), windows } }
  }
  if (e && typeof e === 'object' && (e.type === 'result' || 'total_cost_usd' in e)) {
    // Follow-ups resume the same chat; their cost adds to what the run had already spent.
    run.costUsd = (run.costBefore ?? 0) + Number(e.total_cost_usd ?? 0)
    run.turns = Number(e.num_turns ?? 0) || run.turns
    if (e.session_id) run.sessionId = e.session_id
    if (e.is_error || (e.subtype && e.subtype !== 'success')) {
      run.error = typeof e.result === 'string' && e.result ? e.result : `Ended: ${e.subtype ?? 'error'}`
    } else {
      const result = typeof e.result === 'string' ? e.result : ''
      run.result = result
      // The final answer usually just arrived as text; don't list it twice.
      const last = run.events[run.events.length - 1]
      if (last?.kind === 'text' && last.text.trim() === result.trim()) last.kind = 'result'
      else addEvent(run, 'result', result || 'Done', now)
    }
    return { final: true }
  }
  return { final: false }
}
