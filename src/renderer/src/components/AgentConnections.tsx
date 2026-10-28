import { useState } from 'react'
import { Button, ToolBadge } from './ui'
import { useSharedReadiness } from '../app/useReadiness'

export default function AgentConnections({ onUsage, onTerminal, expanded = false, selection = false }: { onUsage: () => void; onTerminal: () => void; expanded?: boolean; selection?: boolean }) {
  const [open, setOpen] = useState(expanded)
  const { providers, connections, check, cancel, updateSetup } = useSharedReadiness()
  return <section className="agent-connections" aria-label="Agent connections" aria-busy={connections.busy}>
    <button className="connection-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>Agent connections</button>
    {selection && <fieldset><legend>Tools to connect</legend>{(['claude', 'codex'] as const).map(tool => <label key={tool}><input type="checkbox" checked={providers.includes(tool)} disabled={providers.length === 1 && providers.includes(tool)} onChange={e => void updateSetup({ providers: e.target.checked ? [...providers, tool] : providers.filter(p => p !== tool) })} />{tool === 'claude' ? 'Claude' : 'Codex'}</label>)}</fieldset>}
    <div role="status" aria-live="polite">{connections.busy ? 'Checking connections…' : !connections.result ? 'Connections have not been verified.' : connections.result.outcome === 'ready' ? 'Selected connection requirements verified.' : 'Review connection requirements below.'}</div>
    {(['claude', 'codex'] as const).map(tool => <div key={tool} className="connection-row"><ToolBadge tool={tool} /><span>{connections.busy ? 'Checking…' : connections.result?.checks.filter(c => c.id.includes(tool)).map(c => `${c.id.split('.').pop()}: ${c.explanation}`).join(' ') || 'Not verified'}</span></div>)}
    {open && <div className="connection-details">
      {connections.result?.checks.filter(c => !providers.some(p => c.id.includes(p))).map(c => <p key={c.id}>{c.explanation}</p>)}
      {providers.map(tool => <div key={tool}><strong>{tool === 'claude' ? 'Claude Code' : 'Codex'}</strong><p className="muted small">Install the CLI, then sign in in a terminal. Recheck after making changes. Offline or unavailable checks remain unknown.</p><a href={tool === 'claude' ? 'https://code.claude.com/docs/en/setup' : 'https://developers.openai.com/codex/cli/'} target="_blank" rel="noreferrer">{tool} installation guide</a><p>Sign in: <code>{tool === 'claude' ? 'claude auth login' : 'codex login'}</code></p></div>)}
      <p className="muted small">Git is required for isolated worktrees. Install Git and restart the app if a new tool is not found.</p>
      <div className="connection-actions"><Button size="sm" onClick={onTerminal}>Open setup terminal</Button><Button size="sm" onClick={onUsage}>Usage</Button></div>
    </div>}
    <Button size="sm" disabled={connections.busy} onClick={() => void check()}>Recheck connections</Button>
    {connections.busy && <Button size="sm" onClick={() => cancel('connections')}>Cancel connection check</Button>}
  </section>
}
