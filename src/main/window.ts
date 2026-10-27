import { BrowserWindow, Notification, screen, shell } from 'electron'
import { join } from 'node:path'
import { refreshPlanUsage } from './planUsage'
import { checkSoon } from './updater'
import { terminalCount } from './pty'
import { runningTaskCount } from './tasks'
import { runningProjectCommandCount } from './projectCommands'
import { loadStore, updateStore, type WindowBounds } from './store'

let mainWindow: BrowserWindow | null = null
let toldAboutTray = false
let quitting = false

export const getMainWindow = (): BrowserWindow | null => mainWindow

/** True once the app is on its way out (quit, update install); closing the window then really closes it. */
export const isQuitting = (): boolean => quitting
export function setQuitting(): void {
  quitting = true
}

export function showWindow(): void {
  if (!mainWindow) createWindow()
  const win = mainWindow!
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Last window position and size, if it still fits on a connected screen. */
function savedBounds(): WindowBounds | undefined {
  if (process.env.MC_SMOKE) return undefined
  const b = loadStore().window
  if (!b) return undefined
  const area = screen.getDisplayMatching(b).workArea
  const visible = b.x < area.x + area.width - 100 && b.y < area.y + area.height - 100 && b.x + b.width > area.x + 100 && b.y >= area.y - 20
  return visible ? b : undefined
}

export function createWindow(): void {
  const bounds = savedBounds()
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    title: 'Mission Control',
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: '#0d0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (bounds?.maximized) mainWindow.maximize()

  // Coming back to the window: fresh plan numbers (at most every 20 seconds).
  mainWindow.on('focus', () => {
    if (!process.env.MC_SMOKE) {
      void refreshPlanUsage()
      checkSoon()
    }
  })
  mainWindow.on('close', (e) => {
    const win = mainWindow
    if (!win || process.env.MC_SMOKE) return
    const b = win.getNormalBounds()
    updateStore((s) => {
      s.window = { ...b, maximized: win.isMaximized() }
    })
    // With work still running, closing hides to the tray instead of stopping everything.
    const busy = terminalCount() > 0 || runningTaskCount() > 0 || runningProjectCommandCount() > 0
    if (!quitting && busy && loadStore().settings.closeToTray) {
      e.preventDefault()
      win.hide()
      if (!toldAboutTray) {
        toldAboutTray = true
        new Notification({
          title: 'Mission Control is still running',
          body: 'Your agents, tasks and project commands keep going. Open it from the tray icon, or quit from its menu.',
          icon: join(__dirname, '../../build/icon.png')
        }).show()
      }
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Sends to the renderer only while it still exists. Terminals keep emitting output for a
 * moment after the window closes; sending to a destroyed window throws in the main process.
 */
export function sendToWindow(channel: string, ...args: unknown[]): void {
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, ...args)
}
