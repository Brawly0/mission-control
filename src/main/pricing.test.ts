import { describe, expect, it } from 'vitest'
import { costOf, priceFor } from './pricing'

const u = (patch: Partial<Parameters<typeof costOf>[1]>) => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...patch })

describe('priceFor', () => {
  it('matches model families, most specific first', () => {
    expect(priceFor('claude-opus-5-5').input).toBe(4)
    expect(priceFor('claude-opus-5').input).toBe(5)
    expect(priceFor('claude-sonnet-5-5').output).toBe(10)
    expect(priceFor('claude-haiku-4-5-20251001').input).toBe(1)
    expect(priceFor('claude-fable-5-1').cacheRead).toBe(0.25)
  })
  it('prices unknown models like current Opus instead of $0', () => {
    expect(priceFor('something-new').input).toBe(4)
  })
})

describe('costOf', () => {
  it('input and output per million tokens', () => {
    expect(costOf('claude-opus-5-5', u({ input: 1_000_000, output: 1_000_000 }))).toBeCloseTo(24)
  })
  it('cache writes at 1.25x (5m) and 2x (1h) input; reads at the model rate', () => {
    expect(costOf('claude-opus-5', u({ cacheWrite5m: 1_000_000 }))).toBeCloseTo(6.25)
    expect(costOf('claude-opus-5', u({ cacheWrite1h: 1_000_000 }))).toBeCloseTo(10)
    expect(costOf('claude-opus-5', u({ cacheRead: 1_000_000 }))).toBeCloseTo(0.5)
    expect(costOf('claude-opus-5-5', u({ cacheRead: 1_000_000 }))).toBeCloseTo(0.2)
  })
})
