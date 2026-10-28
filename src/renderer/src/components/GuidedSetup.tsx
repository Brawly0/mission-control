import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useSharedReadiness } from '../app/useReadiness'
import AgentConnections from './AgentConnections'
import { Button } from './ui'
import '../setup.css'
export default function GuidedSetup({ onClose, onTerminal, onUsage, onAdd, onNew, onOpenProject, projectName, children }: { onClose: () => void; onTerminal: () => void; onUsage: () => void; onAdd: () => void; onNew: () => void; onOpenProject: () => void; projectName?: string; children: ReactNode }) {
  const { setup, updateSetup, cancel } = useSharedReadiness()
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement; root.current?.focus(); return () => previous?.focus() }, [])
  const leave = (status: 'skipped' | 'dismissed') => { cancel(); void updateSetup({ status }).then(onClose) }
  return <div className="setup-overlay" onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); leave('dismissed') }
    if (e.key === 'Tab') {
      const targets = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')
      if (!targets?.length) return
      const first = targets[0], last = targets[targets.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }}><div ref={root} tabIndex={-1} className="setup-surface" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <header><h1 id="setup-title">Get started with Mission Control</h1><Button onClick={() => leave('dismissed')}>Dismiss setup</Button></header>
    <p>Your projects and settings stay saved. Resume this guide from Home, the sidebar or Settings.</p>
    {!setup && <p role="status">Setup preferences could not be loaded yet. You can still check tools and open projects.</p>}
    <h2>1. Connect your tools</h2><AgentConnections expanded selection onUsage={onUsage} onTerminal={onTerminal} />
    <h2>2. Open a project</h2><p>A project is a folder the agent can work in. Review its Git requirements and commands in the project page.</p>
    <div className="setup-actions"><Button onClick={onAdd}>Add existing folder</Button><Button onClick={onNew}>Create project</Button>{projectName && <Button onClick={onOpenProject}>Open {projectName}</Button>}</div>
    <h2>3. Run and review a task</h2>{children}
    <Button onClick={() => leave('skipped')}>Skip setup for now</Button>
  </div></div>
}
