import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { Task } from '@shared/types'
import { errorMessage } from '../util'
import { Button } from './ui'

export function TaskCliControls({ task }: { task: Task }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!task.teamParentId || task.mode !== 'interactive' || task.column !== 'running') return null
  return <div className="task-cli-controls">
    <span className="muted small">{task.run?.cliState === 'idle' ? 'Your turn. Keep chatting, or finish to continue the team.' : 'Type in the CLI to talk to this agent. Finish after its reply.'}</span>
    <Button size="sm" icon={busy ? Loader2 : CheckCircle2} disabled={busy || task.run?.cliState !== 'idle'} onClick={async () => {
      setBusy(true); setError('')
      try { await window.mc.finishTaskAgent(task.id) }
      catch (err) { setError(errorMessage(err)) }
      finally { setBusy(false) }
    }}>{busy ? 'Finishing…' : 'Finish assignment'}</Button>
    {error && <span className="error small" role="alert">{error}</span>}
  </div>
}
