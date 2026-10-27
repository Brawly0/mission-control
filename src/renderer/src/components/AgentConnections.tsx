import { useEffect, useState } from 'react'
import { ChevronDown, RefreshCw, Terminal } from 'lucide-react'
import type { ClaudeStatus } from '@shared/types'
import { Button, IconButton, ToolBadge } from './ui'

export default function AgentConnections({ onUsage, onTerminal }: { onUsage: () => void; onTerminal: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Record<string, ClaudeStatus | null>>({})
  const load = async (force = false) => {
    setBusy(true)
    const results = await Promise.allSettled([window.mc.claudeStatus(force), window.mc.codexStatus(force)])
    setStatus(Object.fromEntries(results.map((r, i) => [i ? 'codex' : 'claude', r.status === 'fulfilled' ? r.value : null])))
    setBusy(false)
  }
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 300_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <section className="agent-connections" aria-label="Agent connections">
      <button className="connection-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Agent connections</span><ChevronDown size={14} />
      </button>
      {(['claude', 'codex'] as const).map(tool => {
        const s = status[tool]
        // A refresh keeps the last result on screen instead of flashing "Checking" every 5 minutes.
        const label = s === undefined ? 'Checking...' : !s ? 'Check failed' : !s.installed ? 'Not installed' : s.loggedIn ? 'Connected' : 'Sign in needed'
        return <button key={tool} className="connection-row" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ToolBadge tool={tool} /><span className={s?.loggedIn ? 'connection-ok' : 'muted'}>{label}</span>
        </button>
      })}
      {open && <div className="connection-details">
        {(['claude', 'codex'] as const).map(tool => {
          const s = status[tool]
          return <div key={tool} className="small">
            <strong>{tool === 'claude' ? 'Claude Code' : 'Codex'}</strong>
            <div className="muted">{s?.version || 'Version unavailable'}{s?.plan ? ` · ${s.plan[0].toUpperCase()}${s.plan.slice(1)} plan` : ''}</div>
            {s && !s.installed ? <code>npm install -g {tool === 'claude' ? '@anthropic-ai/claude-code' : '@openai/codex'}</code> : s && !s.loggedIn ? <code>{tool === 'claude' ? 'claude auth login' : 'codex login'}</code> : null}
            {!s && <div className="muted">Refresh to try again.</div>}
          </div>
        })}
        <div className="connection-actions">
          <Button size="sm" onClick={onUsage}>Usage</Button>
          <IconButton icon={Terminal} label="Open terminal for setup commands" onClick={onTerminal} />
          <IconButton icon={RefreshCw} label="Refresh agent connections" disabled={busy} className={busy ? 'spinning' : ''} onClick={() => void load(true)} />
        </div>
      </div>}
    </section>
  )
}
