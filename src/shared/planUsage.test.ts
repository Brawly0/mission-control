import { describe, expect, it } from 'vitest'
import { parsePlanUsage, resetsIn } from './planUsage'

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
