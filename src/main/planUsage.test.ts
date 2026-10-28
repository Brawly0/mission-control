import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitInfo } from '../shared/types'

const state = vi.hoisted(() => ({ reading: null as RateLimitInfo | null, read: vi.fn(), record: vi.fn() }))
vi.mock('node:fs', () => ({ promises: { readFile: state.read } }))
vi.mock('./tasks', () => ({ getRateLimit: () => state.reading, setRateLimit: (info: RateLimitInfo) => { state.reading = info } }))
vi.mock('./planCost', () => ({ recordPlanReading: state.record, savedPlanReadings: async () => [] }))
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
let refresh: typeof import('./planUsage').refreshPlanUsage
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubEnv('MC_SMOKE', '')
  state.reading = null
  state.read.mockReset().mockResolvedValue(JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-only', expiresAt: Date.now() + 86400_000 } }))
  state.record.mockReset()
  fetchMock = vi.fn().mockResolvedValue(response({ five_hour: { utilization: 41, resets_at: new Date(Date.now() + 3600_000).toISOString() } }))
  vi.stubGlobal('fetch', fetchMock)
  refresh = (await import('./planUsage')).refreshPlanUsage
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
describe('read-only Claude usage refresh', () => {
  it('publishes success and bounds the account request', async () => {
    const signal = vi.spyOn(AbortSignal, 'timeout')
    await refresh(true)
    expect(state.reading?.windows[0].utilization).toBe(.41)
    expect(signal).toHaveBeenCalledWith(15_000)
    expect(state.record).toHaveBeenCalledOnce()
    expect(state.read).toHaveBeenCalledOnce()
    expect(state.read.mock.calls[0][0]).toContain('.credentials.json')
  })
  it('settles missing credentials without a network request', async () => {
    state.read.mockRejectedValue(new Error('missing'))
    await refresh(true)
    expect(state.reading?.error).toContain('Not logged in')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([401, 403, 429, 500])('settles HTTP %s', async status => {
    fetchMock.mockResolvedValue({ ok: false, status })
    await refresh(true)
    expect(state.reading?.error).toBeTruthy()
  })
  it('settles rejection and retries successfully', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await refresh(true)
    expect(state.reading?.error).toContain('offline')
    await refresh(true)
    expect(state.reading?.error).toBeUndefined()
    expect(state.reading?.windows).toHaveLength(1)
  })
  it('settles a bounded timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new Error('Timed out')), ms)
      return controller.signal
    })
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))))
    const pending = refresh(true)
    await vi.advanceTimersByTimeAsync(15_000)
    await pending
    expect(state.reading?.error).toContain('Timed out')
  })
  it('treats empty successful responses as unavailable', async () => {
    fetchMock.mockResolvedValue(response({}))
    await refresh(true)
    expect(state.reading?.error).toContain('no plan readings')
    expect(state.record).not.toHaveBeenCalled()
  })
  it('retains good values and their timestamp through failed or empty refreshes', async () => {
    await refresh(true)
    const good = structuredClone(state.reading!)
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await refresh(true)
    expect(state.reading).toMatchObject({ at: good.at, windows: good.windows, error: expect.stringContaining('offline') })
    fetchMock.mockResolvedValueOnce(response({}))
    await refresh(true)
    expect(state.reading?.windows).toEqual(good.windows)
  })
  it('deduplicates in-flight requests and enforces the normal minimum gap', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const first = refresh(true), second = refresh(true)
    expect(first).toBe(second)
    await Promise.resolve()
    finish(response({ five_hour: { utilization: 12 } }))
    await first
    await refresh()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('never reads real credentials in ordinary smoke runs', async () => {
    vi.stubEnv('MC_SMOKE', 'fixture.png')
    await refresh(true)
    expect(state.read).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.reading?.error).toContain('disabled')
  })
  it('workspace fixtures recover from unavailable without retaining the failure', async () => {
    vi.stubEnv('MC_SMOKE', 'fixture.png')
    vi.stubEnv('MC_SMOKE_WORKSPACE', '1')
    vi.stubEnv('MC_SMOKE_PLAN_FIXTURE', 'missing')
    await refresh(true)
    expect(state.reading?.error).toContain('credentials')
    vi.stubEnv('MC_SMOKE_PLAN_FIXTURE', '')
    await refresh(true)
    expect(state.reading?.error).toBeUndefined()
    expect(state.reading?.windows[0].utilization).toBe(.41)
    expect(state.read).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
