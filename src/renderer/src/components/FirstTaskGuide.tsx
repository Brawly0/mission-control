import { useId } from 'react'
import type { NewTask } from '@shared/types'
import { firstTaskProgress, STARTER_TASK, type FirstTaskInput } from '../firstTaskGuidance'
import { Button } from './ui'
import '../guidance.css'

export interface FirstTaskGuideProps extends FirstTaskInput {
  onOpenProject: () => void
  /** Open the composer with this editable draft; do not create or start here. */
  onCreateTask: (initial: Partial<NewTask>) => void
  onOpenTask: (id: string, tab?: 'activity' | 'changes') => void
  onSkip: () => void
  onDismiss: () => void
}

export default function FirstTaskGuide(props: FirstTaskGuideProps) {
  const id = useId()
  const progress = firstTaskProgress(props)
  const task = progress.task
  return <section className="card first-task-guide" aria-labelledby={id}>
    <div className="guidance-heading"><h2 id={id}>Your first task</h2><Button size="sm" variant="ghost" onClick={props.onDismiss}>Dismiss guide</Button></div>
    <p role="status" aria-live="polite">{progress.message}</p>
    {task && <p className="muted small">Saved choices: {task.tool ?? 'claude'} · {task.permission} · {task.useWorktree ? 'separate worktree' : 'project folder'}. A worktree is a separate checkout and branch for reviewing changes before merging.</p>}
    <div className="guidance-actions">
      {progress.step === 'project' ? <Button onClick={props.onOpenProject}>Open a project</Button> : !task ? <Button onClick={() => props.onCreateTask({ ...STARTER_TASK, projectPath: props.projectPath })}>Edit starter task</Button> : <>
        <Button onClick={() => props.onOpenTask(task.id, 'activity')}>Open task</Button>
        {task.worktree && (!task.team || task.team.phase === 'review') && <Button onClick={() => props.onOpenTask(task.id, 'changes')}>Inspect changes</Button>}
      </>}
      <Button size="sm" variant="ghost" onClick={props.onSkip}>Skip for now</Button>
    </div>
  </section>
}
