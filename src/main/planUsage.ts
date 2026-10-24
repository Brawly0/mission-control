import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RateLimitInfo } from '../shared/types'
import { forecast, parsePlanUsage, WINDOW_MS } from '../shared/planUsage'
import { recordPlanReading, savedPlanReadings } from './planCost'
import { getRateLimit, setRateLimit } from './tasks'

/**
 * Plan limits around the clock: asks your Claude account how much of the 5-hour session and
 * the weekly limits you've used (the numbers `/usage` shows), with the login Claude Code saved.
 * The credentials file is only read. An expired token is never refreshed here: refreshing
 * rotates the refresh token, and since we can't write it back that would log Claude Code out.
 * Claude Code refreshes it itself whenever it runs.
 */

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const EVERY_MS = 3 * 60_000
const MIN_GAP_MS = 20_000
const MAX_BACKOFF_MS = 15 * 60_000

let timer: NodeJS.Timeout | null = null
let lastFetch = 0
let backoff = 0
let inFlight: Promise<void> | null = null
/** Recent readings per window, [time, utilization], for the pace forecast. Cleared when a window resets. */
const samples = new Map<string, { resetsAt: number; points: [number, number][] }>()

/** Refills the forecast's history from saved readings, so a restart doesn't forget the last hour. */
async function seedSamples(): Promise<void> {
  const rows = await savedPlanReadings(Date.now() - WINDOW_MS.five_hour)
  for (const r of rows) {
    let s = samples.get(r.win)
    if (!s || Math.abs(s.resetsAt - r.resetsAt) > 60_000) samples.set(r.win, (s = { resetsAt: r.resetsAt, points: [] }))
    s.points.push([r.ts, r.util])
    if (s.points.length > 120) s.points.shift()
  }
}

/** Adds this reading to the window's history and attaches where each window is heading. */
function withForecast(info: RateLimitInfo): RateLimitInfo {
  const windows = info.windows.map((w) => {
    let s = samples.get(w.name)
    // resets_at can wobble by milliseconds between responses; a new window moves it by hours.
    if (!s || Math.abs(s.resetsAt - w.resetsAt) > 60_000) samples.set(w.name, (s = { resetsAt: w.resetsAt, points: [] }))
    const f = forecast(w, s.points, info.at)
    s.points.push([info.at, w.utilization])
    if (s.points.length > 120) s.points.shift()
    return { ...w, forecast: f }
  })
  return { ...info, windows }
}

interface Login {
  token: string
  expiresAt: number
  plan?: string
}

async function readLogin(): Promise<Login | null> {
  try {
    const raw = JSON.parse(await fs.readFile(join(homedir(), '.claude', '.credentials.json'), 'utf8'))
    const o = raw?.claudeAiOauth
    if (!o?.accessToken) return null
    return { token: o.accessToken, expiresAt: Number(o.expiresAt ?? 0), plan: o.subscriptionType || undefined }
  } catch {
    return null
  }
}

/** Keeps the last good numbers and says why they couldn't be refreshed. */
function fail(error: string): void {
  const last = getRateLimit()
  setRateLimit({ at: Date.now(), status: '', windows: [], ...last, error })
}

async function fetchOnce(): Promise<void> {
  lastFetch = Date.now()
  const login = await readLogin()
  if (!login) return fail('Not logged in to Claude Code with a Claude account (API-key logins have no plan limits).')
  if (login.expiresAt && login.expiresAt < Date.now()) return fail('Login expired. Run any Claude chat once and it refreshes.')
  try {
    const res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${login.token}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 429) {
      backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : EVERY_MS)
      return fail('Usage check is being rate-limited; trying again later.')
    }
    if (res.status === 401 || res.status === 403) return fail('Claude rejected the saved login. Run any Claude chat once and it refreshes.')
    if (!res.ok) return fail(`Usage check failed (HTTP ${res.status}).`)
    backoff = 0
    const info = withForecast(parsePlanUsage(await res.json(), Date.now(), login.plan))
    setRateLimit({ ...info, error: undefined })
    recordPlanReading(info)
    onFresh?.(info)
  } catch (err) {
    fail(`Usage check failed: ${(err as Error).message}`)
  }
}

/** Fetches now unless a fetch just happened (or is running). */
export function refreshPlanUsage(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && Date.now() - lastFetch < MIN_GAP_MS) return Promise.resolve()
  inFlight = fetchOnce().finally(() => {
    inFlight = null
  })
  return inFlight
}

let onFresh: ((info: RateLimitInfo) => void) | undefined

/** Polls every few minutes (slower while rate-limited); `fresh` sees each successful reading. */
export function startPlanUsage(fresh?: (info: RateLimitInfo) => void): void {
  onFresh = fresh
  let seeded = false
  const tick = async (): Promise<void> => {
    if (!seeded) {
      seeded = true
      await seedSamples().catch(() => undefined)
    }
    void refreshPlanUsage(true).finally(() => {
      timer = setTimeout(tick, Math.max(EVERY_MS, backoff))
    })
  }
  void tick()
}

export function stopPlanUsage(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
