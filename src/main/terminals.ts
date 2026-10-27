import { randomUUID } from 'node:crypto'
import type { HookEvent, TerminalInfo, TerminalSpec } from '../shared/types'
import { codexStates } from '../shared/codex'
import { findNewCodexSession } from './codexData'
import { hookSettingsFor, removeHookSettings } from './hookServer'
import { spawnTerminal } from './pty'
import { launchArgs } from './spend'
import { markEcoSession } from './planCost'
import { sendToWindow } from './window'

/** Extra observers of terminal output and hook events (used by the smoke test). */
export const ptyTaps = new Set<{ data?: (id: string, d: string) => void; exit?: (id: string, code: number) => void }>()
export const hookTaps = new Set<(e: HookEvent) => void>()

/** Status for agents without Claude's hooks travels the same way hook calls do. */
function emitHook(event: HookEvent): void {
  sendToWindow('hook:event', event)
  hookTaps.forEach((tap) => tap(event))
}

/** Terminals still running. */
const live = new Set<string>()

/** Codex chat id per live codex terminal, so two agents in one folder never claim the same chat. */
const codexSessions = new Map<string, string>()

/** Looks for the chat a new codex terminal started (see findNewCodexSession), for up to 30 minutes. */
function watchForCodexSession(id: string, cwd: string, since: number): void {
  let tries = 0
  const look = async () => {
    if (!live.has(id) || codexSessions.has(id) || tries++ > 1200) return
    const sessionId = await findNewCodexSession(cwd, since, new Set(codexSessions.values())).catch(() => null)
    if (sessionId && live.has(id) && ![...codexSessions.values()].includes(sessionId)) {
      codexSessions.set(id, sessionId)
      emitHook({ agentId: id, event: 'CodexSession', sessionId, at: Date.now() })
      return
    }
    setTimeout(look, 1500)
  }
  setTimeout(look, 1000)
}

/** Starts a terminal; claude terminals get hook reporting and a known session id, codex ones a state reader. */
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
  const codex = spec.kind === 'codex'
  if (codex && args[0] === 'resume' && args[1] && !args[1].startsWith('-')) {
    sessionId = args[1]
    codexSessions.set(id, sessionId)
  }
  // An OSC sequence can be split across two chunks; keep the unfinished end for the next one.
  let carry = ''
  live.add(id)
  const info = spawnTerminal(
    { ...spec, args },
    {
      data: (tid, data) => {
        sendToWindow('pty:data', tid, data)
        ptyTaps.forEach((tap) => tap.data?.(tid, data))
        if (!codex) return
        const text = carry + data
        const open = text.lastIndexOf('\x1b]7501;')
        carry = open >= 0 && !/[\x07\x1b]/.test(text.slice(open + 7)) ? text.slice(open, open + 200) : ''
        for (const s of codexStates(text)) emitHook({ agentId: tid, event: 'CodexState', source: s.state, notificationType: s.kind, at: Date.now() })
        // Codex's first-run "Trust this folder?" screen comes before it reports any state.
        if (data.includes('Trust this folder?')) emitHook({ agentId: tid, event: 'CodexState', source: 'blocked', notificationType: 'trust', at: Date.now() })
      },
      exit: (tid, code) => {
        live.delete(tid)
        codexSessions.delete(tid)
        removeHookSettings(tid)
        sendToWindow('pty:exit', tid, code)
        ptyTaps.forEach((tap) => tap.exit?.(tid, code))
      }
    },
    id
  )
  if (codex && !sessionId) watchForCodexSession(id, spec.cwd, Date.now())
  return { ...info, sessionId }
}
