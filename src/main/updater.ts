import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

/**
 * App updates from the public releases repo (Brawly0/mission-control-releases, configured under
 * "publish" in package.json). Updates download in the background and install when the app restarts,
 * or right away with Update now (the top-bar button). Checks run every 30 minutes and when you come
 * back to the window. Only packaged builds update; `npm run dev` never does.
 */

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 30 * 60_000
/** Coming back to the window checks again, at most this often. */
const FOCUS_GAP_MS = 10 * 60_000
let lastCheck = 0
/** Update now was pressed before the download finished: restart as soon as it has. */
let installWhenReady = false
let beforeInstall: (() => void) | null = null

let state: UpdateState = { state: 'idle' }
let notify: ((s: UpdateState) => void) | null = null
let timer: NodeJS.Timeout | null = null

function set(s: UpdateState): void {
  state = s
  notify?.(s)
}

export function updateStatus(): UpdateState {
  return state
}

export function initUpdater(onStatus: (s: UpdateState) => void, autoCheck: boolean): void {
  notify = onStatus
  if (!app.isPackaged) {
    set({ state: 'disabled', message: 'Updates only work in the installed app.' })
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => {
    installWhenReady = false
    set({ state: 'none', version: app.getVersion() })
  })
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('download-progress', (p) => {
    const version = state.state === 'available' || state.state === 'downloading' ? state.version : ''
    set({ state: 'downloading', version, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version })
    if (installWhenReady) installUpdate()
  })
  autoUpdater.on('error', (err) => set({ state: 'error', message: err?.message ?? String(err) }))
  setAutoCheck(autoCheck)
}

export function setAutoCheck(on: boolean): void {
  if (timer) clearInterval(timer)
  timer = null
  if (!on || !app.isPackaged) return
  setTimeout(() => void checkForUpdates(), 15_000)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  lastCheck = Date.now()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: (err as Error).message })
  }
}

/** A check when the window gets focus, unless one ran in the last 10 minutes (or one is under way). */
export function checkSoon(): void {
  if (!app.isPackaged || Date.now() - lastCheck < FOCUS_GAP_MS) return
  if (state.state === 'checking' || state.state === 'downloading' || state.state === 'ready') return
  void checkForUpdates()
}

/** Restarts into the downloaded version. */
export function installUpdate(): void {
  if (state.state !== 'ready') return
  beforeInstall?.()
  autoUpdater.quitAndInstall(false, true)
}

/**
 * The Update button: restarts into a downloaded update now, or checks and downloads one and
 * restarts as soon as it's ready. `prepare` runs just before the restart (e.g. skip close-to-tray).
 */
export function updateNow(prepare: () => void): void {
  beforeInstall = prepare
  if (state.state === 'ready') return installUpdate()
  installWhenReady = true
  if (state.state !== 'downloading' && state.state !== 'checking') void checkForUpdates()
}
