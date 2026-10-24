import type { RateLimitInfo } from './types'

/** Windows the plan-usage endpoint can report, in display order. */
const WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const

/** Short and long names for each plan window. */
export const WINDOW_LABELS: Record<string, { short: string; long: string }> = {
  five_hour: { short: 'Session', long: '5-hour session' },
  seven_day: { short: 'Week', long: 'Weekly (all models)' },
  seven_day_opus: { short: 'Opus wk', long: 'Weekly (Opus)' },
  seven_day_sonnet: { short: 'Sonnet wk', long: 'Weekly (Sonnet)' }
}

export function windowLabel(name: string, long = false): string {
  const l = WINDOW_LABELS[name]
  return l ? (long ? l.long : l.short) : name
}

/**
 * Turns the response of Claude's plan-usage endpoint (what `/usage` shows) into RateLimitInfo.
 * Percentages arrive as 0–100 and reset times as ISO strings; windows that don't apply are null.
 */
export function parsePlanUsage(body: any, now: number, plan?: string): RateLimitInfo {
  const windows: RateLimitInfo['windows'] = []
  for (const name of WINDOWS) {
    const w = body?.[name]
    if (!w || typeof w.utilization !== 'number') continue
    const resetsAt = w.resets_at ? Date.parse(w.resets_at) : 0
    windows.push({ name, utilization: Math.max(0, w.utilization) / 100, resetsAt: Number.isFinite(resetsAt) ? resetsAt : 0 })
  }
  const x = body?.extra_usage
  const extraUsage =
    x && typeof x === 'object'
      ? { enabled: Boolean(x.is_enabled), usedUsd: Number(x.used_credits ?? 0) / 100, limitUsd: Number(x.monthly_limit ?? 0) / 100 }
      : undefined
  const worst = Math.max(0, ...windows.map((w) => w.utilization))
  return { at: now, status: worst >= 1 ? 'limited' : 'allowed', windows, source: 'plan', plan, extraUsage }
}

/** "47m", "3h 12m", "Thu 6:59" – how long until a window resets, short enough for the top bar. */
export function resetsIn(resetsAt: number, now: number): string {
  if (!resetsAt) return ''
  const mins = Math.max(0, Math.round((resetsAt - now) / 60_000))
  if (mins < 60) return `${mins}m`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return new Date(resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}
