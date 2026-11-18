import { describe, expect, it } from 'vitest'
import { claudeEvent, codexEvent, contextWindowFor, type AgentResult } from './agents'

const fresh = (): AgentResult => ({ ok: false, text: '', ms: 0 })
describe('context usage', () => {
  it('keeps the latest Claude prompt including both caches, without summing turns', () => {
    const result = fresh()
    const first = JSON.parse('{"type":"assistant","message":{"id":"m1","content":[],"usage":{"input_tokens":50,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200,"output_tokens":20}}}')
    expect(claudeEvent(first, result)).toContainEqual({ kind: 'usage', text: '', tokens: 20, context: 1250 })
    claudeEvent({ ...first, message: { ...first.message, id: 'm2', usage: { input_tokens: 70, output_tokens: 30 } } }, result)
    claudeEvent({ type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 9999 } }, result)
    expect(result).toMatchObject({ contextTokens: 70, contextWindow: 200000, costUsd: 0.2, ok: true })
  })
  it('handles result-only usage and model initialization', () => {
    const r = fresh()
    claudeEvent({ type: 'system', subtype: 'init', model: 'sonnet[1m]' }, r)
    claudeEvent({ type: 'result', subtype: 'success', usage: { input_tokens: 5, cache_read_input_tokens: 10 } }, r)
    expect(r).toMatchObject({ contextTokens: 15, contextWindow: 1000000 })
  })
  it('preserves Codex accounting while replacing the last prompt size', () => {
    const r = fresh()
    const e = JSON.parse('{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":800,"output_tokens":100}}')
    expect(codexEvent(e, r)[0]).toMatchObject({ context: 1000 })
    codexEvent({ type: 'turn.completed', usage: { input_tokens: 2000, cached_input_tokens: 1000, output_tokens: 200 } }, r)
    expect(r).toMatchObject({ contextTokens: 2000, tokens: 3300, cached: 1800, contextWindow: 272000 })
    codexEvent(JSON.parse('{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":2500},"model_context_window":1000000}}}'), r)
    expect(r).toMatchObject({ contextTokens: 2500, contextWindow: 1000000, tokens: 3300 })
    codexEvent({ type: 'token_count', info: { last_token_usage: { input_tokens: 0 } } }, r)
    expect(r.contextTokens).toBe(0)
  })
  it('ignores subagent usage and keeps a measured Codex prompt over the turn total', () => {
    const r = fresh()
    claudeEvent({ type: 'assistant', message: { id: 'a', content: [], usage: { input_tokens: 300, output_tokens: 1 } } }, r)
    claudeEvent({ type: 'assistant', parent_tool_use_id: 't1', message: { id: 'b', content: [], usage: { input_tokens: 90000, output_tokens: 1 } } }, r)
    expect(r.contextTokens).toBe(300)
    const x = fresh()
    codexEvent({ type: 'token_count', info: { last_token_usage: { input_tokens: 4000 } } }, x)
    codexEvent({ type: 'turn.completed', usage: { input_tokens: 50000, output_tokens: 10 } }, x)
    expect(x).toMatchObject({ contextTokens: 4000, tokens: 50010 })
  })
  it('uses model-dependent defaults', () => {
    expect(contextWindowFor('claude')).toBe(200000)
    expect(contextWindowFor('claude', 'opus[1m]')).toBe(1000000)
    expect(contextWindowFor('claude', 'opus-1m')).toBe(1000000)
    expect(contextWindowFor('codex', 'anything')).toBe(272000)
  })
})
