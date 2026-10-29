import { useEffect, useState } from 'react'
import { RefreshCw, Terminal } from 'lucide-react'
import type { ClaudeStatus } from '@shared/types'
import { Button, IconButton, ToolBadge } from './ui'
import { useSharedReadiness } from '../app/useReadiness'

type Tool = 'claude' | 'codex'
type Reading = { at: number; status: ClaudeStatus }
type Cache = Partial<Record<Tool, Reading>>
const CACHE_KEY = 'mc.connectionStatus.v1'
const MAX_AGE = 30 * 86400_000
const STALE_AGE = 300_000

/** Persist only conservative, non-sensitive compatibility fields. */
export function validConnectionReading(raw: unknown): Reading | undefined {
  if (!raw || typeof raw !== 'object') return
  const r = raw as Reading
  if (!Number.isFinite(r.at) || r.at <= 0 || r.at > Date.now() + 60_000 || Date.now() - r.at > MAX_AGE ||
    !r.status || typeof r.status.installed !== 'boolean' || typeof r.status.loggedIn !== 'boolean' || r.status.error) return
  return { at: r.at, status: { installed: r.status.installed, loggedIn: r.status.loggedIn } }
}
export function parseConnectionCache(value: string | null): Cache {
  try { const raw = JSON.parse(value ?? '{}'); return { claude: validConnectionReading(raw?.claude), codex: validConnectionReading(raw?.codex) } } catch { return {} }
}
function readCache(): Cache { try { return parseConnectionCache(localStorage.getItem(CACHE_KEY)) } catch { return {} } }

/** The compact shell and expanded setup share diagnostics; cache is display-only last-known state. */
export default function AgentConnections({ onUsage, onTerminal, expanded = false, selection = false }: { onUsage: () => void; onTerminal: () => void; expanded?: boolean; selection?: boolean }) {
  const { providers, connections, check, cancel, updateSetup } = useSharedReadiness()
  const [cached, setCached] = useState<Cache>(readCache)
  const [now, setNow] = useState(Date.now)
  const [open, setOpen] = useState(expanded)
  const result = connections.result
  useEffect(() => {
    if (!result || ['cancelled', 'stale', 'checking'].includes(result.outcome)) return
    setCached(previous => {
      const next = { ...previous }
      for (const tool of ['claude', 'codex'] as const) {
        const install = result.checks.find(c => c.id === `${tool}.installation`)
        const auth = result.checks.find(c => c.id === `${tool}.authentication`)
        if (install?.outcome === 'missing' || install?.outcome === 'ready' && auth && ['ready', 'missing'].includes(auth.outcome)) {
          next[tool] = { at: install.checkedAt, status: { installed: install.outcome === 'ready', loggedIn: auth?.outcome === 'ready' } }
        }
      }
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ claude: validConnectionReading(next.claude), codex: validConnectionReading(next.codex) })) } catch { /* optional cache */ }
      return next
    })
    setNow(Date.now())
  }, [result])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer) }, [])
  const failed = (tool: Tool) => !connections.busy && !!result && !['cancelled', 'stale'].includes(result.outcome) &&
    result.checks.some(c => (c.id.startsWith(tool + '.') || c.id === 'diagnostic') && !['ready', 'missing'].includes(c.outcome))
  const label = (tool: Tool) => {
    const r = cached[tool]
    const base = !r ? 'Unknown' : !r.status.installed ? 'Not installed' : r.status.loggedIn ? 'Connected' : 'Sign in needed'
    return `${base}${failed(tool) ? ' · check failed · last known' : r && now - r.at > STALE_AGE ? ' · stale' : ''}`
  }
  const healthy = providers.every(tool => cached[tool]?.status.loggedIn && !failed(tool) && now - cached[tool]!.at <= STALE_AGE)
  const body = <div className="connection-details">
    <strong>Agent connections</strong>
    {selection && <fieldset><legend>Tools to connect</legend>{(['claude', 'codex'] as const).map(tool => <label key={tool}><input type="checkbox" checked={providers.includes(tool)} disabled={providers.length === 1 && providers.includes(tool)} onChange={e => void updateSetup({ providers: e.target.checked ? [...providers, tool] : providers.filter(p => p !== tool) })} />{tool === 'claude' ? 'Claude' : 'Codex'}</label>)}</fieldset>}
    <p className="muted small">Use Claude, Codex, or both. Install and sign in to the CLI you want to use.</p>
    {(['claude', 'codex'] as const).map(tool => <section key={tool}>
      <div className="connection-row"><ToolBadge tool={tool} /><span>{label(tool)}</span></div>
      {cached[tool] && <div className="muted small">Last checked {new Date(cached[tool]!.at).toLocaleString()}</div>}
      {result?.checks.filter(c => c.id.startsWith(tool + '.')).map(c => <p className="small" key={c.id}>{c.explanation}</p>)}
      <a href={tool === 'claude' ? 'https://code.claude.com/docs/en/setup' : 'https://developers.openai.com/codex/cli/'} target="_blank" rel="noreferrer">Installation and setup guide</a>
      <p className="small">Sign in: <code>{tool === 'claude' ? 'claude auth login' : 'codex login'}</code></p>
    </section>)}
    {result?.checks.filter(c => !c.id.startsWith('claude.') && !c.id.startsWith('codex.')).map(c => <p key={c.id} className="small">{c.explanation}</p>)}
    <p className="muted small" role="status">{connections.busy ? 'Refreshing quietly…' : 'Restart after installing to pick up the updated PATH. Unavailable checks remain unverified.'}</p>
    <div className="connection-actions"><Button size="sm" onClick={onUsage}>Usage</Button><IconButton icon={Terminal} label="Open terminal for setup commands" onClick={onTerminal} />
      {selection ? <Button size="sm" disabled={connections.busy} onClick={() => void check()}>Recheck connections</Button> : <IconButton icon={RefreshCw} label="Refresh agent connections" disabled={connections.busy} onClick={() => void check()} />}
      {connections.busy && <Button size="sm" onClick={() => cancel('connections')}>Cancel connection check</Button>}
    </div>
  </div>
  if (expanded || selection) return <section className="agent-connections" aria-label="Agent connections" aria-busy={connections.busy}><button className="connection-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>Agent connections</button>{open && body}</section>
  return <details className="agent-connections" onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.open = false }}><summary className="connection-toggle" aria-label={`Agent connections: Claude ${label('claude')}; Codex ${label('codex')}`} title={`Claude ${label('claude')}; Codex ${label('codex')}`}><span className={`connection-dot ${healthy ? 'connected' : 'unknown'}`} aria-hidden /></summary>{body}</details>
}
