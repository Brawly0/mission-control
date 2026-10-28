import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Terminal } from 'lucide-react'
import type { ClaudeStatus } from '@shared/types'
import { Button, IconButton, ToolBadge } from './ui'

type Tool = 'claude' | 'codex'
type Reading = { at: number; status: ClaudeStatus }
type Cache = Partial<Record<Tool, Reading>>
const CACHE_KEY = 'mc.connectionStatus.v1'
const MAX_AGE = 30 * 86400_000
const STALE_AGE = 300_000

/** Whitelist only non-sensitive fields; never persist arbitrary CLI output or errors. */
export function validConnectionReading(raw: unknown): Reading | undefined {
  if (!raw || typeof raw !== 'object') return
  const r = raw as Reading
  if (!Number.isFinite(r.at) || r.at <= 0 || r.at > Date.now() + 60_000 || Date.now() - r.at > MAX_AGE ||
    !r.status || typeof r.status.installed !== 'boolean' || typeof r.status.loggedIn !== 'boolean' || r.status.error) return
  return { at: r.at, status: { installed: r.status.installed, loggedIn: r.status.loggedIn } }
}
export function parseConnectionCache(value: string | null): Cache {
  try {
    const raw = JSON.parse(value ?? '{}')
    return { claude: validConnectionReading(raw?.claude), codex: validConnectionReading(raw?.codex) }
  } catch { return {} }
}
function readCache(): Cache {
  try { return parseConnectionCache(localStorage.getItem(CACHE_KEY)) } catch { return {} }
}

export default function AgentConnections({ onUsage, onTerminal }: { onUsage: () => void; onTerminal: () => void }) {
  const [status, setStatus] = useState<Cache>(readCache)
  const statusRef = useRef(status)
  const [errors, setErrors] = useState<Partial<Record<Tool, string>>>({})
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [now, setNow] = useState(Date.now())
  const load = async (force = false) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const results = await Promise.allSettled([window.mc.claudeStatus(force), window.mc.codexStatus(force)])
      const next = { ...statusRef.current }
      const failed: Partial<Record<Tool, string>> = {}
      results.forEach((r, i) => {
        const tool = i ? 'codex' : 'claude'
        if (r.status === 'fulfilled' && !r.value.error) next[tool] = { at: Date.now(), status: r.value }
        else failed[tool] = 'Check failed. Last known status retained; refresh to try again.'
      })
      statusRef.current = next
      setStatus(next)
      setErrors(failed)
      const safe = { claude: validConnectionReading(next.claude), codex: validConnectionReading(next.codex) }
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(safe)) } catch { /* storage can be disabled */ }
    } finally { pending.current = false; setBusy(false); setNow(Date.now()) }
  }
  useEffect(() => {
    void load()
    const timer = setInterval(() => { setNow(Date.now()); void load() }, STALE_AGE)
    return () => clearInterval(timer)
  }, [])
  const tools = ['claude', 'codex'] as const
  const label = (tool: Tool) => {
    const r = status[tool]
    const base = !r ? 'Unknown' : !r.status.installed ? 'Not installed' : r.status.loggedIn ? 'Connected' : 'Sign in needed'
    return `${base}${errors[tool] ? ' · check failed' : r && now - r.at > STALE_AGE ? ' · stale' : ''}`
  }
  const healthy = tools.every(tool => status[tool]?.status.loggedIn && !errors[tool] && now - status[tool]!.at <= STALE_AGE)
  return <details className="agent-connections" onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.open = false }}>
    <summary className="connection-toggle" aria-label={`Agent connections: Claude ${label('claude')}; Codex ${label('codex')}`} title={`Claude ${label('claude')}; Codex ${label('codex')}`}>
      <span className={`connection-dot ${healthy ? 'connected' : 'unknown'}`} aria-hidden />
    </summary>
    <div className="connection-details">
      <strong>Agent connections</strong>
      <p className="muted small">Use Claude, Codex, or both. Install and sign in to the CLI you want to use.</p>
      {tools.map(tool => {
        const r = status[tool], s = r?.status
        return <section key={tool}>
          <div className="connection-row"><ToolBadge tool={tool} /><span>{label(tool)}</span></div>
          <div className="muted small">{s?.version || 'Version unavailable'}{r ? ` · Checked ${new Date(r.at).toLocaleString()}` : ' · Not checked yet'}</div>
          {errors[tool] && <p className="plan-error small" role="status">{errors[tool]}</p>}
          <a href={tool === 'claude' ? 'https://code.claude.com/docs/en/setup' : 'https://developers.openai.com/codex/cli/'} target="_blank" rel="noreferrer">Installation and setup guide</a>
          {(!s?.loggedIn || errors[tool]) && <div className="small">Sign in from a terminal: <code>{tool === 'claude' ? 'claude auth login' : 'codex login'}</code></div>}
        </section>
      })}
      <p className="muted small" role="status">{busy ? 'Refreshing quietly…' : 'Restart after installing to pick up the updated PATH.'}</p>
      <div className="connection-actions">
        <Button size="sm" onClick={onUsage}>Usage</Button>
        <IconButton icon={Terminal} label="Open terminal for setup commands" onClick={onTerminal} />
        <IconButton icon={RefreshCw} label="Refresh agent connections" disabled={busy} onClick={() => void load(true)} />
      </div>
    </div>
  </details>
}
