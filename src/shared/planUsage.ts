import type { PaceForecast, RateLimitInfo } from './types'

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
  if (resetsAt - now < 86_400_000) return duration(resetsAt - now)
  return new Date(resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** "29m", "3h 12m", "2d 4h". */
export function duration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
}

const HOUR = 3_600_000
/** How long each window lasts; it starts this long before it resets. */
export const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 168 * HOUR, seven_day_opus: 168 * HOUR, seven_day_sonnet: 168 * HOUR }

/**
 * Where a window is heading. The session window uses the last hour of readings (how you're
 * working right now) once there are at least 15 minutes of them; otherwise, and for weekly
 * windows, the average pace since the window started, which already includes nights and breaks.
 * samples: [time, utilization] readings in this window, oldest first.
 */
export function forecast(w: { name: string; utilization: number; resetsAt: number }, samples: [number, number][], now: number): PaceForecast | undefined {
  const span = WINDOW_MS[w.name]
  if (!span || !w.resetsAt || w.resetsAt <= now) return undefined
  const start = w.resetsAt - span
  let basis: PaceForecast['basis'] = 'window'
  let perMs = w.utilization / Math.max(60_000, now - start)
  if (w.name === 'five_hour') {
    const recent = samples.filter(([at]) => at >= Math.max(start, now - HOUR) && at < now)
    const first = recent[0]
    if (first && now - first[0] >= 15 * 60_000) {
      basis = 'recent'
      perMs = Math.max(0, (w.utilization - first[1]) / (now - first[0]))
    }
  }
  const atReset = w.utilization + perMs * (w.resetsAt - now)
  let runsOutAt = 0
  if (w.utilization >= 1) runsOutAt = now
  else if (perMs > 0) {
    const out = now + (1 - w.utilization) / perMs
    if (out < w.resetsAt) runsOutAt = Math.round(out)
  }
  return { ratePerHour: perMs * HOUR, atReset, runsOutAt, basis }
}

/** One line for tooltips and the Usage card: "Runs out ~3:10 PM, 29m before it resets" or "~62% by reset". */
export function paceText(w: { resetsAt: number; forecast?: PaceForecast }, now: number): string {
  const f = w.forecast
  if (!f) return ''
  if (f.runsOutAt) {
    const when = f.runsOutAt - now < 86_400_000
      ? new Date(f.runsOutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : new Date(f.runsOutAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    return `At this pace it runs out ~${when}, ${duration(w.resetsAt - f.runsOutAt)} before it resets`
  }
  return `At this pace: ~${Math.round(Math.min(1, f.atReset) * 100)}% by reset${f.atReset >= 0.9 ? ' (close)' : ''}`
}
