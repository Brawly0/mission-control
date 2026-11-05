import { app } from 'electron'
import { mkdirSync, writeFileSync, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { HookEvent, Task, TaskRun } from '../shared/types'
import { codexReply } from '../shared/codex'
import { codexFileFor } from './codexData'
import { findSessionFile } from './spend'
import { launchTerminal, hookTaps, ptyTaps } from './terminals'
import { killTerminal } from './pty'

type CliState = NonNullable<TaskRun['cliState']>

/** Only authoritative CLI events change completion readiness; silence is not completion. */
export function taskCliState(event: HookEvent): CliState | undefined {
  if (event.event === 'UserPromptSubmit' || event.event === 'PostToolUse') return 'working'
  if (event.event === 'Stop') return 'idle'
  if (event.event === 'Notification' && event.notificationType === 'permission_prompt') return 'needs-input'
  if (event.event === 'CodexState') {
    if (event.source === 'working') return 'working'
    if (event.source === 'done') return 'idle'
    if (event.source === 'blocked') return 'needs-input'
  }
  return undefined
}

/** A real CLI in the existing terminal host. Tasks owns its lifetime, not any particular pane. */
export function startTaskCli(task: Task, cwd: string, prompt: string, onState: (state: CliState | undefined, sessionId?: string, lastReply?: string) => void, onExit: (code: number) => void) {
  const dir = join(app.getPath('userData'), 'task-assignments')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${task.id}.md`)
  writeFileSync(file, prompt, 'utf8')
  // Keep long assignments/handoffs off Windows' command line. The CLI reads the full file itself.
  const initial = `Read the assignment file ${JSON.stringify(file)} and carry out its instructions. Finish with a written handoff, then wait for the user.`
  const args = [...(task.model ? ['--model', task.model] : []),
    ...(task.tool === 'codex' ? ['-s', task.permission === 'plan' ? 'read-only' : 'workspace-write'] : ['--permission-mode', task.permission]), initial]
  const info = launchTerminal({ cwd, args, kind: task.tool ?? 'claude', cols: 120, rows: 30 })
  let exited = false
  let resolveExit: () => void
  const exit = new Promise<void>(resolve => { resolveExit = resolve })
  const hook = (event: HookEvent) => {
    if (event.agentId === info.id) onState(taskCliState(event), event.sessionId, event.lastReply)
  }
  const tap = { exit: (id: string, code: number) => {
    if (id !== info.id) return
    exited = true
    hookTaps.delete(hook); ptyTaps.delete(tap)
    resolveExit()
    onExit(code)
  } }
  hookTaps.add(hook); ptyTaps.add(tap)
  return { ...info, get exited() { return exited }, close: async () => {
    if (exited) return
    killTerminal(info.id)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([exit, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The CLI is still stopping. Wait before resuming the team.')), 10_000)
      })])
    } finally { clearTimeout(timer) }
  } }
}

/** Stream a transcript and retain only the last assistant turn, without loading a large chat. */
export async function taskCliResult(task: Task): Promise<string> {
  if (task.tool !== 'codex' && task.run?.result?.trim()) return task.run.result.trim()
  const id = task.run?.sessionId
  if (!id) throw new Error('Waiting for the CLI session. Complete a reply before finishing the assignment.')
  const file = task.tool === 'codex' ? await codexFileFor(id) : await findSessionFile(id)
  if (!file) throw new Error('The CLI has not saved its reply yet. Try Finish assignment again shortly.')
  let result = ''
  for await (const line of createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })) {
    try {
      const entry = JSON.parse(line)
      if (task.tool === 'codex') {
        if (entry.type === 'event_msg' && entry.payload?.type === 'task_started') result = ''
        const reply = entry.payload?.phase === 'commentary' ? '' : codexReply(entry)
        if (reply) result = (result + '\n' + reply).slice(-24_000)
      } else {
        if (entry.type === 'user' && !entry.message?.content?.some?.((part: any) => part.type === 'tool_result')) result = ''
        if (entry.type === 'assistant' && !entry.isSidechain) {
          const text = entry.message?.content?.filter?.((part: any) => part.type === 'text').map((part: any) => part.text).join('\n')
          if (text) result = (result + '\n' + text).slice(-24_000)
        }
      }
    } catch { /* skip partial/unknown records */ }
  }
  if (!result.trim()) throw new Error('No written handoff was saved. Ask the CLI for a final summary, then finish the assignment.')
  return result.trim()
}
