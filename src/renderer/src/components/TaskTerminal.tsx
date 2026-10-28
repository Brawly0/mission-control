import { lazy, Suspense } from 'react'
import type { Task } from '@shared/types'

const TerminalPane = lazy(() => import('./TerminalPane'))
const TaskConsole = lazy(() => import('./TaskConsole'))

/** A task's actual PTY or the coordinated runner's streamed CLI output. */
export function TaskTerminal({ task, visible }: { task: Task; visible: boolean }) {
  const agentId = task.mode === 'interactive' ? task.run?.agentId : undefined
  return <Suspense fallback={<div className="muted pad small">Loading terminal…</div>}>
    {agentId ? <TerminalPane id={agentId} visible={visible} autoFocus={false} onExit={() => undefined} />
      : task.mode === 'interactive' ? <div className="muted pad small">The agent terminal was closed.</div>
      : <TaskConsole taskId={task.id} visible={visible} />}
  </Suspense>
}
