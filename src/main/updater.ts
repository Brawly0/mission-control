import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

/**
 * App updates from the public releases repo (Brawly0/mission-control-releases, configured under
 * "publish" in package.json). Updates download in the background and install when the app restarts.
 * Only packaged builds update; `npm run dev` never does.
 */

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 6 * 3_600_000

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
  autoUpdater.on('update-not-available', () => set({ state: 'none', version: app.getVersion() }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('download-progress', (p) => {
    const version = state.state === 'available' || state.state === 'downloading' ? state.version : ''
    set({ state: 'downloading', version, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
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
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: (err as Error).message })
  }
}

/** Restarts into the downloaded version. */
export function installUpdate(): void {
  if (state.state === 'ready') autoUpdater.quitAndInstall(false, true)
}
