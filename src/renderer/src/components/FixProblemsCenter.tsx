import { useId, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { type Problem, type ProblemAction, problemActionLabel } from '../problems'
import { Button } from './ui'
import '../guidance.css'

export interface FixProblemsCenterProps {
  problems: Problem[]
  onAction: (action: ProblemAction) => void
  /** Action handlers own async failures and feed fresh state back into the model. */
  busy?: boolean
}

export default function FixProblemsCenter({ problems, onAction, busy = false }: FixProblemsCenterProps) {
  const id = useId()
  const section = useRef<HTMLElement>(null)
  const act = (action: ProblemAction) => {
    // If verification removes the focused row, retain a predictable focus target.
    section.current?.focus()
    onAction(action)
  }
  return <section ref={section} tabIndex={-1} className="card fix-problems-center" aria-labelledby={id} aria-busy={busy}>
    <h2 id={id}><AlertTriangle size={16} aria-hidden="true" /> Fix problems <span className="count">{problems.length}</span></h2>
    <p className="muted small" role="status">{problems.length ? 'Problems remain until a newer check verifies the fix. Retrying is always your choice.' : 'No verified problems recorded. Checks that have not run are still unknown.'}</p>
    <ul className="guidance-problems">{problems.map(problem => <li key={problem.id}>
      <div><h3>{problem.title}</h3><p>{problem.effect}</p><p className="muted small">{problem.next}</p></div>
      <div className="guidance-actions"><Button size="sm" disabled={busy} aria-label={`${problemActionLabel(problem.action)}: ${problem.title}`} onClick={() => act(problem.action)}>{problemActionLabel(problem.action)}</Button>
        {problem.secondary && <Button size="sm" disabled={busy} aria-label={`${problemActionLabel(problem.secondary)}: ${problem.title}`} onClick={() => act(problem.secondary!)}>{problemActionLabel(problem.secondary)}</Button>}
      </div>
    </li>)}</ul>
  </section>
}
