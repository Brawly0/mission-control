import type { EcoCompare, PlanRate, WindowRate } from './types'

/**
 * Plan cost (ADR 0016): what share of your plan limits a chat, task or project used. Claude
 * reports plan usage only as a percentage per window, so Mission Control calibrates it: it
 * compares how far each window moved between two readings with the usage your chats logged
 * in that time (in API-priced dollars, which already weigh models and cache reads), and turns
 * that into "share of the window per dollar".
 */

/** One saved plan reading: a window's utilization (0–1) at a time. */
export interface PlanReading {
  ts: number
  win: string
  resetsAt: number
  util: number
}

/** One logged reply: when, what it would cost at API prices, which model, how many tokens. */
export interface CostPoint {
  ts: number
  cost: number
  model: string
  tokens: number
}

/** How far back the calibration looks. */
export const CALIBRATION_DAYS = 14
const MIN = 60_000
/** Readings further apart than this aren't paired (the app was closed; too much else could have happened). */
const MAX_GAP = 12 * 60 * MIN
/** A step in utilization this soon after local usage still counts as local (the server rounds and lags). */
const LAG = 15 * MIN
/** Replies logged in the last few minutes may not be indexed yet. */
const SETTLE = 5 * MIN

/** Model-specific windows only count that model's usage. */
function modelFilter(win: string): ((model: string) => boolean) | null {
  if (win === 'seven_day_opus') return (m) => /opus/i.test(m)
  if (win === 'seven_day_sonnet') return (m) => /sonnet/i.test(m)
  return null
}

/** The least evidence before a rate is shown: dollars of local usage and share of the window it moved. */
function enough(win: string, usd: number, share: number): boolean {
  return usd >= 2 && share >= (win === 'five_hour' ? 0.05 : 0.02)
}

/**
 * Share of each window per API-priced dollar, from paired readings. A pair is two readings of
 * the same window (same reset time) at most 12 hours apart. When a window moved while nothing
 * ran on this computer (claude.ai, the phone, another PC), that move is left out and reported
 * as `outside`.
 */
export function calibrate(readings: PlanReading[], costs: CostPoint[], now: number): Record<string, WindowRate> {
  const sorted = [...costs].sort((a, b) => a.ts - b.ts)
  // Prefix sums per filter, so each pair's cost is two binary searches.
  const prefix = (keep: ((m: string) => boolean) | null): { ts: number[]; sum: number[] } => {
    const ts: number[] = []
    const sum: number[] = [0]
    for (const c of sorted) {
      if (keep && !keep(c.model)) continue
      ts.push(c.ts)
      sum.push(sum[sum.length - 1] + c.cost)
    }
    return { ts, sum }
  }
  /** Index of the first point after t. */
  const after = (ts: number[], t: number): number => {
    let lo = 0
    let hi = ts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ts[mid] <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const byWin = new Map<string, PlanReading[]>()
  for (const r of readings) {
    if (r.ts > now - SETTLE) continue
    byWin.set(r.win, [...(byWin.get(r.win) ?? []), r])
  }
  const out: Record<string, WindowRate> = {}
  for (const [win, list] of byWin) {
    list.sort((a, b) => a.ts - b.ts)
    const p = prefix(modelFilter(win))
    const costIn = (from: number, to: number) => p.sum[after(p.ts, to)] - p.sum[after(p.ts, from)]
    let usd = 0
    let share = 0
    let outside = 0
    let from = 0
    let to = 0
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]
      const b = list[i]
      if (Math.abs(a.resetsAt - b.resetsAt) > MIN || b.ts - a.ts > MAX_GAP) continue
      const moved = b.util - a.util
      if (moved < 0) continue
      const cost = costIn(a.ts, b.ts)
      if (cost <= 0 && moved > 0 && costIn(a.ts - LAG, a.ts) <= 0) {
        outside += moved
        continue
      }
      if (cost <= 0 && moved === 0) continue
      usd += cost
      share += moved
      if (!from) from = a.ts
      to = b.ts
    }
    if (enough(win, usd, share)) out[win] = { perUsd: share / usd, usd, share, from, to, outside }
  }
  return out
}

/** API-priced dollars per million tokens for each model (all token kinds, cache reads included), most used first. */
export function modelPrices(costs: CostPoint[]): PlanRate['models'] {
  const by = new Map<string, { cost: number; tokens: number }>()
  for (const c of costs) {
    if (!c.tokens) continue
    const cur = by.get(c.model) ?? { cost: 0, tokens: 0 }
    cur.cost += c.cost
    cur.tokens += c.tokens
    by.set(c.model, cur)
  }
  return [...by]
    .filter(([, v]) => v.cost > 0)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, v]) => ({ model, usdPerMTok: (v.cost / v.tokens) * 1e6, tokens: v.tokens }))
}

/** Share (0–1) of a plan window that this much API-priced usage takes, or undefined without a rate. */
export function planShare(usd: number | undefined, rate: PlanRate | null | undefined, win = 'seven_day'): number | undefined {
  const r = rate?.windows[win]
  if (!r || usd === undefined || !Number.isFinite(usd)) return undefined
  return usd * r.perUsd
}

/** "0.4%", "<0.1%", "12%". */
export function formatShare(share: number): string {
  const pct = share * 100
  if (pct <= 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  if (pct < 10) return `${pct.toFixed(1).replace(/\.0$/, '')}%`
  return `${Math.round(pct)}%`
}

/** Tokens of one model that make up 1% of a window: "1% of your week ≈ 2.1M tokens on Sonnet". */
export function tokensPerPercent(rate: PlanRate, model: string, win = 'seven_day'): number | undefined {
  const r = rate.windows[win]
  const m = rate.models.find((x) => x.model === model)
  if (!r || !m || !m.usdPerMTok) return undefined
  return (0.01 / r.perUsd / m.usdPerMTok) * 1e6
}

/** "claude-haiku-4-5-20251001" → "Haiku 4.5"; ids it doesn't recognize stay as they are. */
export function modelFamily(model: string): string {
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  if (!m) return model
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

/**
 * Does Eco mode save anything? Compares the average API-priced cost per reply in chats started
 * with Eco on against the others in the same period. Needs at least 30 replies on each side.
 */
export function ecoVerdict(c: EcoCompare): { saving: number; ecoPerReply: number; otherPerReply: number } | null {
  if (c.eco.replies < 30 || c.other.replies < 30) return null
  const ecoPerReply = c.eco.cost / c.eco.replies
  const otherPerReply = c.other.cost / c.other.replies
  if (otherPerReply <= 0) return null
  return { saving: 1 - ecoPerReply / otherPerReply, ecoPerReply, otherPerReply }
}
