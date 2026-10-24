import { describe, expect, it } from 'vitest'
import { forecast, paceText, parsePlanUsage, resetsIn } from './planUsage'

const NOW = Date.parse('2026-10-24T12:00:00Z')
// Trimmed from a real response (Pro plan, Oct 24 2026).
const BODY = {
  five_hour: { utilization: 89.0, resets_at: '2026-10-24T13:39:59.517004+00:00' },
  seven_day: { utilization: 33.0, resets_at: '2026-10-30T04:59:59.517025+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false, monthly_limit: 10000, used_credits: 0.0 }
}

describe('parsePlanUsage', () => {
  it('reads the session and weekly windows as 0–1 with epoch-ms resets', () => {
    const info = parsePlanUsage(BODY, NOW, 'pro')
    expect(info.windows).toEqual([
      { name: 'five_hour', utilization: 0.89, resetsAt: Date.parse('2026-10-24T13:39:59.517Z') },
      { name: 'seven_day', utilization: 0.33, resetsAt: Date.parse('2026-10-30T04:59:59.517Z') }
    ])
    expect(info).toMatchObject({ at: NOW, source: 'plan', plan: 'pro', status: 'allowed' })
  })
  it('converts extra-usage cents to dollars', () => {
    expect(parsePlanUsage(BODY, NOW).extraUsage).toEqual({ enabled: false, usedUsd: 0, limitUsd: 100 })
  })
  it('includes model-specific weekly windows when present', () => {
    const info = parsePlanUsage({ ...BODY, seven_day_opus: { utilization: 50, resets_at: null } }, NOW)
    expect(info.windows.map((w) => w.name)).toEqual(['five_hour', 'seven_day', 'seven_day_opus'])
    expect(info.windows[2].resetsAt).toBe(0)
  })
  it('marks a full window as limited', () => {
    expect(parsePlanUsage({ five_hour: { utilization: 100, resets_at: null } }, NOW).status).toBe('limited')
  })
  it('survives an empty or odd body', () => {
    expect(parsePlanUsage(undefined, NOW).windows).toEqual([])
    expect(parsePlanUsage({ five_hour: { utilization: 'x' } }, NOW).windows).toEqual([])
  })
})

describe('resetsIn', () => {
  it('uses minutes, then hours, then a weekday', () => {
    expect(resetsIn(NOW + 47 * 60_000, NOW)).toBe('47m')
    expect(resetsIn(NOW + (3 * 60 + 12) * 60_000, NOW)).toBe('3h 12m')
    expect(resetsIn(NOW + 3 * 86_400_000, NOW)).toMatch(/\d/)
    expect(resetsIn(0, NOW)).toBe('')
  })
})

describe('forecast', () => {
  const H = 3_600_000
  it('session: uses the last hour of readings once there are 15 minutes of them', () => {
    // 60% now, 40% half an hour ago: 40%/h. 40% left => runs out in 1h, reset in 2h.
    const w = { name: 'five_hour', utilization: 0.6, resetsAt: NOW + 2 * H }
    const f = forecast(w, [[NOW - 0.5 * H, 0.4]], NOW)!
    expect(f.basis).toBe('recent')
    expect(f.ratePerHour).toBeCloseTo(0.4)
    expect(f.runsOutAt).toBe(NOW + H)
    expect(f.atReset).toBeCloseTo(1.4)
  })
  it('session: falls back to the window average with too little history', () => {
    // Window started 3h ago (resets in 2h), 30% used: 10%/h => 50% by reset.
    const f = forecast({ name: 'five_hour', utilization: 0.3, resetsAt: NOW + 2 * H }, [[NOW - 5 * 60_000, 0.29]], NOW)!
    expect(f.basis).toBe('window')
    expect(f.atReset).toBeCloseTo(0.5)
    expect(f.runsOutAt).toBe(0)
  })
  it('session: idle for the last hour means no run-out', () => {
    const f = forecast({ name: 'five_hour', utilization: 0.9, resetsAt: NOW + H }, [[NOW - 0.5 * H, 0.9]], NOW)!
    expect(f.ratePerHour).toBe(0)
    expect(f.runsOutAt).toBe(0)
  })
  it('weekly: average since the week started', () => {
    // 2 days in (5 days to go), 40% used: 20%/day => out in 3 days, before the reset.
    const f = forecast({ name: 'seven_day', utilization: 0.4, resetsAt: NOW + 120 * H }, [], NOW)!
    expect(f.basis).toBe('window')
    expect(f.runsOutAt).toBe(NOW + 72 * H)
  })
  it('a used-up window runs out now; unknown resets give nothing', () => {
    expect(forecast({ name: 'five_hour', utilization: 1, resetsAt: NOW + H }, [], NOW)!.runsOutAt).toBe(NOW)
    expect(forecast({ name: 'five_hour', utilization: 0.5, resetsAt: 0 }, [], NOW)).toBeUndefined()
  })
})

describe('paceText', () => {
  it('says how long before the reset it runs out, or where it ends up', () => {
    const H = 3_600_000
    expect(paceText({ resetsAt: NOW + 2 * H, forecast: { ratePerHour: 0.4, atReset: 1.4, runsOutAt: NOW + H, basis: 'recent' } }, NOW)).toMatch(/runs out ~.*, 1h 0m before it resets/)
    expect(paceText({ resetsAt: NOW + 2 * H, forecast: { ratePerHour: 0.1, atReset: 0.62, runsOutAt: 0, basis: 'window' } }, NOW)).toBe('At this pace: ~62% by reset')
  })
})
