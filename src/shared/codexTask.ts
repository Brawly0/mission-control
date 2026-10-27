import type { TaskPermission, TaskRun } from './types'

/** Explicit task permissions; background tasks never wait for a hidden approval prompt. */
export function codexTaskArgs(permission: TaskPermission, model?: string, resume?: string): string[] {
  const policy = permission === 'bypassPermissions' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-c', 'approval_policy="never"', '-c', `sandbox_mode="${permission === 'plan' ? 'read-only' : 'workspace-write'}"`]
  return ['exec', ...(resume ? ['resume', resume] : []), '--json', '--skip-git-repo-check', ...policy, ...(model ? ['--model', model] : []), '-']
}

export function applyCodexTaskEvent(run: TaskRun, e: any, add: (kind: 'info' | 'tool' | 'text' | 'error' | 'result', text: string) => void): boolean {
  if (e?.type === 'thread.started') run.sessionId = e.thread_id
  if (e?.type === 'item.started' || e?.type === 'item.completed') {
    const item = e.item
    if (item?.type === 'agent_message' && e.type === 'item.completed') { run.result = String(item.text ?? ''); run.activity = run.result.slice(0, 120); add('text', run.result) }
    else if (item?.type === 'command_execution' || item?.type === 'file_change' || item?.type === 'mcp_tool_call' || item?.type === 'web_search') {
      if (e.type === 'item.started') { run.toolCalls++; run.activity = item.command || item.type.replace(/_/g, ' '); add('tool', run.activity!) }
      else if (item.exit_code) add('info', `Command exited ${item.exit_code}: ${item.command ?? ''}`)
    }
  }
  if (e?.type === 'error' || e?.type === 'turn.failed') { run.error = String(e.message ?? e.error?.message ?? 'Codex task failed'); add('error', run.error) }
  if (e?.type === 'turn.completed') { add('result', run.result || 'Done'); return true }
  return e?.type === 'turn.failed'
}
