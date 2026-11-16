import type { HookEvent } from '@shared/types'
import type { Agent, HookStatus } from './types'

export interface DisplayStatus {
  cls: 'working' | 'needs-input' | 'done' | 'ready' | 'idle' | 'exited'
  label: string
}

/** Without hooks (plain shells), output in the last few seconds counts as working. */
export const OUTPUT_WORKING_MS = 2500

export function displayStatus(agent: Agent, lastOutput: number | undefined): DisplayStatus {
  if (agent.exited) return { cls: 'exited', label: `exited (${agent.exitCode ?? '?'})` }
  switch (agent.hookStatus) {
    case 'working':
      return { cls: 'working', label: 'working' }
    case 'needs-input':
      return { cls: 'needs-input', label: agent.statusMessage || 'needs you' }
    case 'done':
      return { cls: 'done', label: 'done · your turn' }
    case 'ready':
      return { cls: 'ready', label: 'ready' }
  }
  if (lastOutput && Date.now() - lastOutput < OUTPUT_WORKING_MS) return { cls: 'working', label: 'working' }
  return { cls: 'idle', label: 'idle' }
}

export interface StatusChange {
  status: HookStatus
  message?: string
  /** Whether this change deserves a desktop notification. */
  notify: boolean
}

/** Maps a hook call to the agent's new status, or null when it doesn't change it. */
export function statusFromHook(event: HookEvent, current: HookStatus | undefined): StatusChange | null {
  switch (event.event) {
    case 'SessionStart':
      return { status: 'ready', notify: false }
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return { status: 'working', notify: false }
    case 'Stop':
      return { status: 'done', notify: true }
    case 'Notification': {
      const permission = event.notificationType === 'permission_prompt' || /permission/i.test(event.message ?? '')
      // The "waiting for your input" reminder after a finished turn adds nothing new.
      if (!permission && (current === 'done' || current === 'ready')) return null
      return { status: 'needs-input', message: event.message, notify: true }
    }
    // Codex reports its state in the terminal (OSC 7501, read in main/terminals.ts); `source` is the state.
    case 'CodexState':
      switch (event.source) {
        case 'working':
          return { status: 'working', notify: false }
        case 'done':
          return { status: 'done', notify: true }
        case 'blocked':
          return {
            status: 'needs-input',
            message:
              event.notificationType === 'permission' ? 'Codex needs your approval' : event.notificationType === 'trust' ? 'Codex asks whether to trust this folder' : 'Codex is waiting for you',
            notify: true
          }
        case 'idle':
          // Idle at start means ready; idle after a turn shouldn't hide "your turn".
          return current ? null : { status: 'ready', notify: false }
        default:
          return null
      }
    default:
      return null
  }
}

/** Arguments that reopen a chat: `claude --resume <id>` or `codex resume <id>`. */
export function resumeArgs(tool: 'claude' | 'codex', sessionId: string): string[] {
  return tool === 'codex' ? ['resume', sessionId] : ['--resume', sessionId]
}

/** The chat a launch reopens, if its arguments resume one. */
export function resumedSession(kind: string, args: string[]): string | undefined {
  if (kind === 'codex') return args[0] === 'resume' && args[1] && !args[1].startsWith('-') ? args[1] : undefined
  const at = args.indexOf('--resume')
  return at >= 0 ? args[at + 1] : undefined
}

/**
 * What a hook call changes in the activity strip: the tool Claude is on (set before the call, cleared once
 * it's done, so between calls the strip reads "Thinking") and the files it has written.
 */
export function activityFromHook(event: HookEvent, agent: Pick<Agent, 'activity' | 'edited'>): Pick<Agent, 'activity' | 'edited'> {
  switch (event.event) {
    case 'PreToolUse':
      return { activity: event.tool ? { ...event.tool, at: event.at } : agent.activity, edited: agent.edited }
    case 'PostToolUse': {
      const file = event.tool?.file
      const edited = file ? [...(agent.edited ?? []).filter((f) => f.toLowerCase() !== file.toLowerCase()), file] : agent.edited
      return { activity: undefined, edited }
    }
    case 'UserPromptSubmit':
    case 'Stop':
    case 'SessionStart':
      return { activity: undefined, edited: agent.edited }
    default:
      return agent
  }
}
