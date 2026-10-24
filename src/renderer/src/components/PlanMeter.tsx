import { useEffect, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import type { RateLimitInfo } from '@shared/types'
import { duration, paceText, resetsIn, windowLabel } from '@shared/planUsage'
import { timeAgo } from '../util'

interface Props {
  info: RateLimitInfo | null
  onOpen: () => void
}

/** Older than this, the numbers are shown dimmed: the poll runs every 3 minutes. */
const STALE_MS = 15 * 60_000

export function levelClass(pct: number): string {
  return pct >= 90 ? 'high' : pct >= 70 ? 'warn' : ''
}

/** Session and weekly plan limits, always in view: how much is used and when each resets. */
export default function PlanMeter({ info, onOpen }: Props) {
  // Re-render every 30 seconds so the countdowns stay current between polls.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const windows = (info?.windows ?? []).filter((w) => w.name === 'five_hour' || w.name === 'seven_day' || w.utilization > 0)
  if (!info || !windows.length) {
    return (
      <button className="plan-meter plan-meter-empty" onClick={onOpen} title={info?.error ?? 'Checking your plan limits…'}>
        {info?.error ? <CircleAlert size={14} /> : null}
        <span>{info?.error ? 'Plan limits unavailable' : 'Plan limits…'}</span>
      </button>
    )
  }
  const stale = now - info.at > STALE_MS
  const tip = [
    ...windows.map((w) => {
      const pct = Math.round(w.utilization * 100)
      const when = w.resetsAt ? new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'unknown'
      const pace = paceText(w, now)
      return `${windowLabel(w.name, true)}: ${pct}% used, ${Math.max(0, 100 - pct)}% left · resets ${when}${pace ? `\n  ${pace}` : ''}`
    }),
    info.plan ? `Plan: ${info.plan[0].toUpperCase()}${info.plan.slice(1)}` : '',
    `Updated ${timeAgo(info.at)}`,
    info.error ?? '',
    'Click for details'
  ].filter(Boolean).join('\n')

  return (
    <button className={`plan-meter ${stale ? 'stale' : ''}`} onClick={onOpen} title={tip}>
      {windows.map((w) => {
        const pct = Math.round(w.utilization * 100)
        const f = w.forecast
        // Heading to run out before the reset: say when, instead of when it resets.
        const outIn = f?.runsOutAt && pct < 100 ? Math.max(0, f.runsOutAt - now) : null
        const projected = f ? Math.min(100, Math.round(f.atReset * 100)) : 0
        return (
          <span key={w.name} className={`plan-meter-item ${outIn !== null ? 'pace-out' : ''}`}>
            <span className="plan-meter-name">{windowLabel(w.name)}</span>
            <span className="plan-meter-track" aria-hidden>
              {projected > pct && <span className={`plan-meter-projected ${levelClass(projected)}`} style={{ width: `${projected}%` }} />}
              <span className={`plan-meter-fill ${levelClass(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className={`plan-meter-pct ${levelClass(pct)}`}>{pct}%</span>
            {outIn !== null ? (
              <span className="plan-meter-reset plan-meter-out">out in {duration(outIn)}</span>
            ) : (
              w.resetsAt > 0 && <span className="plan-meter-reset">{resetsIn(w.resetsAt, now)}</span>
            )}
          </span>
        )
      })}
      {info.error && <CircleAlert size={14} className="plan-meter-error" />}
    </button>
  )
}
