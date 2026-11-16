import type { AgentTool, TerminalKind } from './types'

/** Claude and Codex terminals have chats, hooks, briefings and handoffs; shell and mc terminals don't. */
export function isAgentTool(kind: TerminalKind | undefined): kind is AgentTool {
  return kind === 'claude' || kind === 'codex'
}

export const KIND_LABEL: Record<TerminalKind, string> = { claude: 'Claude', codex: 'Codex', mc: 'mc', shell: 'Terminal' }
