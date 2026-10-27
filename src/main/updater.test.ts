import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => {
  const events = new Map<string, (...args: any[]) => void>()
  return { events, updater: { autoDownload: false, autoInstallOnAppQuit: false,
    on: vi.fn((event: string, fn: (...args: any[]) => void) => events.set(event, fn)),
    checkForUpdates: vi.fn(), quitAndInstall: vi.fn() } }
})
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.25.0' } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mock.updater } }))

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); mock.events.clear(); vi.clearAllMocks(); mock.updater.checkForUpdates.mockResolvedValue(null) })
afterEach(() => vi.useRealTimers())

describe('update lifecycle', () => {
  it('respects disabled automatic checks on focus and cancels the startup timer', async () => {
    const u = await import('./updater')
    u.initUpdater(() => {}, true); u.setAutoCheck(false); u.checkSoon()
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(mock.updater.checkForUpdates).not.toHaveBeenCalled()
    await u.checkForUpdates()
    expect(mock.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
  it('shares an in-flight check and keeps a ready download intact', async () => {
    const u = await import('./updater'); u.initUpdater(() => {}, false)
    let finish!: () => void
    mock.updater.checkForUpdates.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const a = u.checkForUpdates(), b = u.checkForUpdates()
    expect(a).toBe(b)
    await Promise.resolve(); expect(mock.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    finish(); await a
    mock.events.get('update-downloaded')!({ version: '0.26.0' })
    await u.checkForUpdates()
    expect(u.updateStatus()).toEqual({ state: 'ready', version: '0.26.0' })
    expect(mock.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
  it('does not restart unexpectedly after a failed Update now request', async () => {
    const u = await import('./updater'); u.initUpdater(() => {}, false)
    mock.updater.checkForUpdates.mockRejectedValue(new Error('Offline'))
    u.updateNow(() => {})
    await u.checkForUpdates()
    expect(u.updateStatus()).toMatchObject({ state: 'error', message: 'Offline' })
    mock.events.get('update-downloaded')!({ version: '0.26.0' })
    expect(mock.updater.quitAndInstall).not.toHaveBeenCalled()
    u.installUpdate()
    expect(mock.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
