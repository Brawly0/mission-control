/**
 * Anthropic API list prices in USD per million tokens, used to *estimate* what Claude Code usage
 * would cost on the API. On a Pro/Max subscription you don't pay these amounts.
 * Source: Anthropic model pricing as of 2026-10. Cache writes are 1.25x input (5-minute) or 2x (1-hour);
 * cache reads are 0.1x input unless a model lists its own rate.
 */
interface Price {
  input: number
  output: number
  cacheRead?: number
}

const PRICES: [RegExp, Price][] = [
  [/fable-5-1|mythos-5-1/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-5|opus-4-[5-9]/, { input: 5, output: 25 }],
  [/opus-4|opus-3/, { input: 15, output: 75 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet/, { input: 3, output: 15 }],
  [/haiku-5/, { input: 0.1, output: 0.5 }],
  [/haiku-4|haiku-3-5/, { input: 1, output: 5 }],
  [/haiku/, { input: 0.25, output: 1.25 }]
]

/** Unknown models are priced like the current Opus so totals don't silently read as $0. */
const FALLBACK: Price = { input: 4, output: 20, cacheRead: 0.2 }

export function priceFor(model: string): Price {
  return PRICES.find(([re]) => re.test(model))?.[1] ?? FALLBACK
}

export interface Usage {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export function costOf(model: string, u: Usage): number {
  const p = priceFor(model)
  const read = p.cacheRead ?? p.input * 0.1
  return (u.input * p.input + u.output * p.output + u.cacheWrite5m * p.input * 1.25 + u.cacheWrite1h * p.input * 2 + u.cacheRead * read) / 1_000_000
}
