import { useSharedReadiness } from '../app/useReadiness'
import { Button } from './ui'
export default function ProjectReadiness({ path, onCommands }: { path: string; onCommands: () => void }) {
  const { projects, check, cancel } = useSharedReadiness()
  const snapshot = projects[path]
  return <section className="project-readiness card" aria-label="Project readiness" aria-busy={snapshot?.busy}>
    <h2>Project readiness</h2>
    <p role="status" aria-live="polite">{snapshot?.busy ? 'Checking folder, Git history and root package manifests…' : !snapshot?.result ? 'Project requirements have not been verified.' : 'Latest folder check completed. Review each requirement below.'}</p>
    <ul>{snapshot?.result?.checks.map(c => <li key={c.id}><span>{c.id.replace('project.', '')}: </span><strong>{c.outcome === 'ready' ? 'Verified' : c.outcome === 'unavailable' ? 'Unknown' : c.outcome}</strong>: {c.explanation}</li>)}</ul>
    <p className="muted small">Command detection supports root package.json scripts. Checks never install dependencies, initialize Git or run commands. For missing Git history, use the project’s Git setup controls and make an initial commit when ready.</p>
    <div className="setup-actions"><Button size="sm" disabled={snapshot?.busy} onClick={() => void check(path)}>Recheck project readiness</Button>{snapshot?.busy && <Button size="sm" onClick={() => cancel(path)}>Cancel project check</Button>}<Button size="sm" onClick={onCommands}>Review project commands</Button></div>
  </section>
}
