import type { EcoCompare, PlanRate, RateLimitInfo } from '../shared/types'
import type { PlanReading } from '../shared/planCost'
import { queryIndex } from './indexer'
import { loadStore, updateStore } from './store'
import { ecoSettings } from './eco'

/**
 * Plan cost (ADR 0016): plan readings are saved in the index database, and every few minutes
 * they're compared with the usage your chats logged, giving "share of each window per
 * API-priced dollar". The UI uses that to show what a chat, task or project took of your plan.
 */

const MAX_AGE_MS = 10 * 60_000
const ECO_DAYS = 30
let cached: PlanRate | null = null
let computing: Promise<PlanRate> | null = null

/** Saves a successful reading (the index worker keeps 90 days). */
export function recordPlanReading(info: RateLimitInfo): void {
  if (!info.windows.length || info.source !== 'plan') return
  void queryIndex('addPlanReading', info.at, info.windows.map(({ name, utilization, resetsAt }) => ({ name, utilization, resetsAt }))).catch(() => undefined)
}

/** Saved readings since a time, for the pace forecast after a restart. */
export function savedPlanReadings(since: number): Promise<PlanReading[]> {
  return queryIndex<PlanReading[]>('planReadings', since).catch(() => [])
}

async function compute(): Promise<PlanRate> {
  const now = Date.now()
  const base = await queryIndex<Omit<PlanRate, 'at' | 'eco'>>('planCalibration', now)
  const ids = Object.keys(loadStore().ecoSessions)
  const eco = ids.length ? await queryIndex<EcoCompare>('ecoCompare', now - ECO_DAYS * 86_400_000, ids).catch(() => undefined) : undefined
  return { ...base, at: now, eco }
}

/** The latest rate, recomputed when older than 10 minutes (or when asked). */
export function planRate(force = false): Promise<PlanRate> {
  if (cached && !force && Date.now() - cached.at < MAX_AGE_MS) return Promise.resolve(cached)
  if (computing) return computing
  computing = compute()
    .then((r) => (cached = r))
    .finally(() => {
      computing = null
    })
  return computing
}

/** Notes that this chat runs with Eco mode on, for the Eco check (first launch counts). */
export function markEcoSession(sessionId: string | undefined): void {
  if (!sessionId || !ecoSettings().enabled || process.env.MC_SMOKE) return
  if (loadStore().ecoSessions[sessionId]) return
  updateStore((s) => {
    s.ecoSessions[sessionId] = Date.now()
    // Keep the newest 1000.
    const entries = Object.entries(s.ecoSessions)
    if (entries.length > 1000) s.ecoSessions = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, 1000))
  })
}
