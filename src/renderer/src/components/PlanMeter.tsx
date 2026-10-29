import { useEffect, useState } from 'react'
import type { RateLimitInfo } from '@shared/types'
import { windowLabel } from '@shared/planUsage'
import { timeAgo } from '../util'

interface Props {
  info: RateLimitInfo | null
  codex: RateLimitInfo | null
  loading: boolean
  onRetry: () => Promise<void>
  onOpen: () => void
}
export function levelClass(pct: number): string {
  return pct >= 90 ? 'high' : pct >= 70 ? 'warn' : ''
}

/** Session first, then all-model weekly, then the provider's first reported window. */
export default function PlanMeter({ info, codex, loading, onRetry, onOpen }: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const providers = [{ label: 'Claude', reading: info, reported: false }, { label: 'Codex', reading: codex, reported: true }]
  const percent = (reading: RateLimitInfo | null, reported: boolean) => {
    const w = reading?.windows.find(w => w.name === 'five_hour') ?? reading?.windows.find(w => w.name === 'seven_day') ?? reading?.windows[0]
    return w ? `${Math.round((reported && w.resetsAt > 0 && w.resetsAt < now ? 0 : w.utilization) * 100)}%` : null
  }
  return <details className="provider-chip"
    onMouseEnter={e => { e.currentTarget.open = true }}
    onMouseLeave={e => { if (!e.currentTarget.contains(document.activeElement)) e.currentTarget.open = false }}
    onFocus={e => { e.currentTarget.open = true }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }}
    onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.open = false }}>
    <summary aria-label="Provider plan limits details" onClick={e => { e.preventDefault(); e.currentTarget.parentElement!.setAttribute('open', '') }}>
      {providers.map(({ label, reading, reported }, i) => <span key={label}>
        {i > 0 && <span aria-hidden> · </span>}{label} {percent(reading, reported) ?? (reported ? '—' : loading ? (info?.error ? 'Retrying…' : 'Loading…') : 'Unavailable')}
        {reading?.error || (!reported && reading?.windows.length && now - reading.at > 900_000) ? ' !' : ''}
      </span>)}
    </summary>
    <div className="provider-details">
      <p className="muted small">Chip: 5-hour session usage; otherwise all-model weekly usage, then the first reported window below.</p>
      {providers.map(({ label, reading, reported }) => <section key={label}>
        <strong>{label}</strong>
        {!reported && loading && <p role="status">{reading?.error ? 'Retrying' : 'Refreshing'} Claude plan limits…</p>}
        {!reading?.windows.length && <p>{reported ? 'No limits reported. Codex reports while it runs.' : loading ? 'Waiting for the first reading.' : "Couldn't load Claude plan limits."}</p>}
        {reading?.windows.map(w => {
          const reset = reported && w.resetsAt > 0 && w.resetsAt < now
          return <p key={w.name}>{windowLabel(w.name, true)}: {reset ? 0 : Math.round(w.utilization * 100)}% used · {reset ? 'reset since last report' : w.resetsAt ? `resets ${new Date(w.resetsAt).toLocaleString()}` : 'reset time unknown'}</p>
        })}
        {reading && reading.windows.length > 0 && <p className="muted small">{reported ? 'Last reported' : reading.error || now - reading.at > 900_000 ? 'Stale reading from' : 'Updated'} {timeAgo(reading.at)}{reported ? ' · reported only while running' : ''}</p>}
        {reading?.error && <p className="plan-error" role="status">{reading.error}{reading.windows.length ? ' Showing the last good reading.' : ''}</p>}
      </section>)}
      <div className="connection-actions">
        <button className="btn btn-sm" onClick={onOpen}>Open Usage</button>
        <button className="btn btn-sm" disabled={loading} onClick={() => void onRetry()}>Retry Claude plan limits</button>
      </div>
    </div>
  </details>
}
