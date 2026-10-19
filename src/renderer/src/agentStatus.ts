import type { HookEvent } from '@shared/types'
import type { Agent, HookStatus } from './types'

export interface DisplayStatus {
  cls: 'working' | 'needs-input' | 'done' | 'ready' | 'idle' | 'exited'
  label: string
}

/** Without hooks (plain shells), output in the last few seconds counts as working. */
const WORKING_MS = 2500

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
  if (lastOutput && Date.now() - lastOutput < WORKING_MS) return { cls: 'working', label: 'working' }
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
    default:
      return null
  }
}
