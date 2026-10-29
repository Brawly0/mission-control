import { useEffect, useState } from 'react'
import type { RateLimitInfo } from '@shared/types'
import { duration, resetsIn, windowLabel } from '@shared/planUsage'
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
  return <details className="provider-chip"
    onMouseLeave={e => { if (!e.currentTarget.contains(document.activeElement)) e.currentTarget.open = false }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }}
    onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.open = false }}>
    <summary aria-label="Provider plan limits details" onClick={e => { e.preventDefault(); e.currentTarget.parentElement!.setAttribute('open', '') }}>
      {providers.map(({ label, reading, reported }) => {
        const preferred = reading?.windows.filter(w => w.name === 'five_hour' || w.name === 'seven_day') ?? []
        const windows = preferred.length ? preferred : reading?.windows.slice(0, 1) ?? []
        const stale = !!reading && !reported && now - reading.at > 900_000
        return <span key={label} className={`plan-meter ${stale ? 'stale' : ''}`} data-provider={label.toLowerCase()}>
          <span className="plan-meter-tool">{label}</span>
          {!windows.length && <span>{reported ? 'No limits reported' : loading ? (info?.error ? 'Retrying…' : 'Loading…') : 'Unavailable'}</span>}
          {windows.map(w => {
            const reset = reported && w.resetsAt > 0 && w.resetsAt < now
            const pct = Math.round((reset ? 0 : w.utilization) * 100)
            const outIn = !reset && w.forecast?.runsOutAt && pct < 100 ? Math.max(0, w.forecast.runsOutAt - now) : null
            const projected = !reset && w.forecast ? Math.min(100, Math.round(w.forecast.atReset * 100)) : 0
            return <span key={w.name} className="plan-meter-item" title={`${windowLabel(w.name, true)}: ${pct}% used${w.resetsAt ? ` · resets ${new Date(w.resetsAt).toLocaleString()}` : ''}`}>
              <span className="plan-meter-name">{windowLabel(w.name)}</span>
              <span className="plan-meter-track" aria-hidden>{projected > pct && <span className={`plan-meter-projected ${levelClass(projected)}`} style={{ width: `${projected}%` }} />}<span className={`plan-meter-fill ${levelClass(pct)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></span>
              <span className={`plan-meter-pct ${levelClass(pct)}`}>{pct}%</span>
              {outIn !== null ? <span className="plan-meter-reset plan-meter-out">out in {duration(outIn)}</span> : !reset && w.resetsAt > 0 && <span className="plan-meter-reset">{resetsIn(w.resetsAt, now)}</span>}
            </span>
          })}
          {reading?.error && <span className="plan-meter-error" title={reading.error}>!</span>}
        </span>
      })}
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
