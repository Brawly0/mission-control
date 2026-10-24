import { describe, expect, it } from 'vitest'
import { calibrate, ecoVerdict, formatShare, modelFamily, modelPrices, planShare, tokensPerPercent, type CostPoint, type PlanReading } from './planCost'

const H = 3_600_000
const T0 = Date.parse('2026-10-20T08:00:00Z')
const RESET = T0 + 100 * H
const NOW = T0 + 48 * H

/** Readings every 3 hours with the given utilizations. */
const week = (utils: number[], win = 'seven_day', resetsAt = RESET): PlanReading[] => utils.map((util, i) => ({ ts: T0 + i * 3 * H, win, resetsAt, util }))
const cost = (hoursAfterT0: number, usd: number, model = 'claude-sonnet-4-5', tokens = 1_000_000): CostPoint => ({ ts: T0 + hoursAfterT0 * H, cost: usd, model, tokens })

describe('calibrate', () => {
  it('divides how far the window moved by the usage logged in between', () => {
    const rates = calibrate(week([0.1, 0.12, 0.15]), [cost(1, 2), cost(4, 3)], NOW)
    expect(rates.seven_day.perUsd).toBeCloseTo(0.05 / 5)
    expect(rates.seven_day).toMatchObject({ usd: 5, outside: 0 })
  })
  it('leaves out moves with no local usage nearby (claude.ai, other computers)', () => {
    const rates = calibrate(week([0.1, 0.12, 0.2, 0.22]), [cost(1, 2), cost(7, 2)], NOW)
    expect(rates.seven_day.share).toBeCloseTo(0.04)
    expect(rates.seven_day.outside).toBeCloseTo(0.08)
  })
  it('counts a step just after local usage as local (server rounding)', () => {
    // Usage 10 minutes before the reading at 3h; the window only moves by the next reading.
    const rates = calibrate(week([0.1, 0.1, 0.13]), [cost(2.85, 3)], NOW)
    expect(rates.seven_day).toMatchObject({ usd: 3, outside: 0 })
    expect(rates.seven_day.share).toBeCloseTo(0.03)
  })
  it('never pairs readings across a reset or a long gap', () => {
    const r = [...week([0.5, 0.55]), { ts: T0 + 6 * H, win: 'seven_day', resetsAt: RESET + 168 * H, util: 0.01 }, { ts: T0 + 30 * H, win: 'seven_day', resetsAt: RESET + 168 * H, util: 0.4 }]
    const rates = calibrate(r, [cost(1, 5), cost(10, 100)], NOW)
    expect(rates.seven_day.usd).toBe(5)
  })
  it('needs enough evidence before giving a rate', () => {
    expect(calibrate(week([0.1, 0.11]), [cost(1, 1)], NOW).seven_day).toBeUndefined()
  })
  it('ignores readings from the last few minutes (their replies may not be indexed yet)', () => {
    const r = [{ ts: NOW - 20 * 60_000, win: 'seven_day', resetsAt: RESET, util: 0.1 }, { ts: NOW - 60_000, win: 'seven_day', resetsAt: RESET, util: 0.2 }]
    expect(calibrate(r, [{ ts: NOW - 10 * 60_000, cost: 10, model: 'x', tokens: 1 }], NOW).seven_day).toBeUndefined()
  })
  it('counts only that model for model-specific windows', () => {
    const rates = calibrate(week([0.1, 0.13], 'seven_day_opus'), [cost(1, 3, 'claude-opus-4-1'), cost(2, 50)], NOW)
    expect(rates.seven_day_opus.usd).toBe(3)
  })
})

describe('shares', () => {
  const rate = { at: NOW, windows: { seven_day: { perUsd: 0.01, usd: 10, share: 0.1, from: T0, to: NOW, outside: 0 } }, models: modelPrices([cost(1, 3, 'claude-opus-4-1'), cost(2, 1)]) }
  it('turns API-priced dollars into a share of the window', () => {
    expect(planShare(2, rate)).toBeCloseTo(0.02)
    expect(planShare(2, rate, 'five_hour')).toBeUndefined()
    expect(planShare(undefined, rate)).toBeUndefined()
  })
  it('formats shares compactly', () => {
    expect(formatShare(0.0004)).toBe('<0.1%')
    expect(formatShare(0.023)).toBe('2.3%')
    expect(formatShare(0.02)).toBe('2%')
    expect(formatShare(0.456)).toBe('46%')
  })
  it('works out tokens per 1% for each model', () => {
    expect(rate.models.map((m) => m.model)).toEqual(['claude-opus-4-1', 'claude-sonnet-4-5'])
    // 1% = $1; Sonnet here costs $1 per million tokens.
    expect(tokensPerPercent(rate, 'claude-sonnet-4-5')).toBeCloseTo(1_000_000)
    expect(tokensPerPercent(rate, 'claude-opus-4-1')).toBeCloseTo(333_333, -1)
  })
})

describe('modelFamily', () => {
  it('names models by family and version', () => {
    expect(modelFamily('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelFamily('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelFamily('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelFamily('gpt-x')).toBe('gpt-x')
  })
})

describe('ecoVerdict', () => {
  it('compares cost per reply once both sides have enough replies', () => {
    expect(ecoVerdict({ since: 0, eco: { chats: 2, replies: 10, cost: 1 }, other: { chats: 5, replies: 100, cost: 20 } })).toBeNull()
    const v = ecoVerdict({ since: 0, eco: { chats: 3, replies: 50, cost: 5 }, other: { chats: 5, replies: 100, cost: 20 } })!
    expect(v.saving).toBeCloseTo(0.5)
  })
})
