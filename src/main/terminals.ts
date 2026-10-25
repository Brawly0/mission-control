import { randomUUID } from 'node:crypto'
import type { HookEvent, TerminalInfo, TerminalSpec } from '../shared/types'
import { hookSettingsFor, removeHookSettings } from './hookServer'
import { spawnTerminal } from './pty'
import { launchArgs } from './spend'
import { markEcoSession } from './planCost'
import { sendToWindow } from './window'

/** Extra observers of terminal output and hook events (used by the smoke test). */
export const ptyTaps = new Set<{ data?: (id: string, d: string) => void; exit?: (id: string, code: number) => void }>()
export const hookTaps = new Set<(e: HookEvent) => void>()

/** Starts a terminal; claude terminals get hook reporting and a known session id. */
export function launchTerminal(spec: TerminalSpec): TerminalInfo {
  const id = randomUUID()
  let sessionId: string | undefined
  let args = spec.args
  if (spec.kind === 'claude') {
    const resumeAt = args.indexOf('--resume')
    if (resumeAt >= 0) {
      sessionId = args[resumeAt + 1]
    } else if (!args.includes('--continue')) {
      // Choosing the id up front lets the app restore this exact session later.
      sessionId = randomUUID()
      args = ['--session-id', sessionId, ...args]
    }
    // The project's default model for new chats, and only the MCP servers it loads.
    args = [...launchArgs(spec.cwd, { newChat: resumeAt < 0 && !args.includes('--continue'), hasModel: args.includes('--model') }), ...args]
    args = ['--settings', hookSettingsFor(id), ...args]
    markEcoSession(sessionId)
  }
  const info = spawnTerminal(
    { ...spec, args },
    {
      data: (tid, data) => {
        sendToWindow('pty:data', tid, data)
        ptyTaps.forEach((tap) => tap.data?.(tid, data))
      },
      exit: (tid, code) => {
        removeHookSettings(tid)
        sendToWindow('pty:exit', tid, code)
        ptyTaps.forEach((tap) => tap.exit?.(tid, code))
      }
    },
    id
  )
  return { ...info, sessionId }
}
