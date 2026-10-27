import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawnSync: mock.spawn }))
import { terminateProcessTreesSync } from './processCleanup'

beforeEach(() => { mock.spawn.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

it('retries surviving owned roots after a failed tree-kill batch', () => {
  const alive = new Set([123, 456])
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (!alive.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    if (signal !== 0) alive.delete(pid)
    return true
  })
  mock.spawn.mockImplementationOnce(() => { alive.delete(123); return { status: 1 } })
    .mockImplementationOnce(() => { alive.clear(); return { status: 0 } })
  terminateProcessTreesSync([123, 456, 123])
  expect(mock.spawn).toHaveBeenCalledTimes(process.platform === 'win32' ? 2 : 0)
  if (process.platform === 'win32') expect(mock.spawn.mock.calls[1][1]).toEqual(['/T', '/F', '/PID', '456'])
  expect(alive.size).toBe(0)
})

it('falls back to killing owned roots when taskkill fails or times out', () => {
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  mock.spawn.mockReturnValue({ status: null, error: new Error('timeout') })
  terminateProcessTreesSync([123])
  expect(kill).toHaveBeenCalledWith(123, 'SIGKILL')
  if (process.platform === 'win32') {
    expect(mock.spawn).toHaveBeenCalledTimes(2)
    expect(console.warn).toHaveBeenCalled()
  }
})

it('ignores invalid ids and never targets a process group', () => {
  const kill = vi.spyOn(process, 'kill')
  terminateProcessTreesSync([0, -1, NaN, 1.5])
  expect(mock.spawn).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled()
})
