import { createContext, useContext } from 'react'
import type { PlanRate } from '@shared/types'
import { formatShare, planShare } from '@shared/planCost'
import { formatCost } from './util'

/** What things cost on your plan (ADR 0016), loaded by App and refreshed as the index updates. */
export const PlanRateContext = createContext<PlanRate | null>(null)

export function usePlanRate(): PlanRate | null {
  return useContext(PlanRateContext)
}

/** "1% of your week ≈ $1.80 of usage at API prices, measured over …" for tooltips. */
export function rateExplainer(rate: PlanRate, win = 'seven_day'): string {
  const r = rate.windows[win]
  if (!r) return ''
  const days = Math.max(1, Math.round((r.to - r.from) / 86_400_000))
  return `1% of your ${win === 'five_hour' ? '5-hour session' : 'weekly limit'} ≈ ${formatCost(0.01 / r.perUsd)} of usage at API prices, measured from your plan readings over the last ${days === 1 ? 'day' : `${days} days`}. Use outside this computer isn't in your chats, so it isn't counted.`
}

/**
 * A chat's, task's or project's share of your weekly limit, e.g. "0.4% wk". Renders nothing
 * until enough plan readings have been saved to estimate it.
 */
export function PlanShare({ usd, win = 'seven_day', prefix = '', long = false, className = '' }: { usd: number | undefined; win?: string; prefix?: string; long?: boolean; className?: string }) {
  const rate = usePlanRate()
  const share = planShare(usd, rate, win)
  if (share === undefined || !rate) return null
  const session = win === 'five_hour'
  // More than a whole window (a project over months): count windows instead.
  const text =
    share >= 1
      ? `${share.toFixed(share < 10 ? 1 : 0)} ${session ? 'sessions' : 'weeks'}`
      : `${formatShare(share)} ${session ? (long ? 'of a session' : 'sess') : long ? 'of your week' : 'wk'}`
  const what = session ? '5-hour session limit' : 'weekly limit'
  const amount = share >= 1 ? `${share.toFixed(1)} times your` : `${formatShare(share)} of your`
  return (
    <span className={`plan-share ${className}`} title={`≈ ${amount} ${what} (estimate).\n${rateExplainer(rate, win)}`}>
      {prefix}≈{text}
    </span>
  )
}
