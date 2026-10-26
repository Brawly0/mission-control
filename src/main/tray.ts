import { app, globalShortcut, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { join } from 'node:path'

/**
 * Tray icon and global show/hide hotkey. The tray keeps Mission Control reachable while it runs in the
 * background (agents and headless tasks keep going when the window is closed to the tray).
 */

let tray: Tray | null = null
let registered = ''

interface TrayDeps {
  getWindow: () => BrowserWindow | null
  showWindow: () => void
  navigate: (target: { view: string; newTask?: boolean }) => void
  quit: () => void
  /** Short status for the tooltip and menu, e.g. { agents: 2, attention: 1, tasks: 1 }. */
  status: () => { agents: number; attention: number; tasks: number }
  hotkey: () => string
}

let deps: TrayDeps | null = null

export function toggleWindow(): void {
  const win = deps?.getWindow()
  if (win && win.isVisible() && win.isFocused()) win.hide()
  else deps?.showWindow()
}

function buildMenu(): Menu {
  const s = deps!.status()
  const summary = [
    `${s.agents} ${s.agents === 1 ? 'agent' : 'agents'} open`,
    s.attention ? `${s.attention} need${s.attention === 1 ? 's' : ''} you` : '',
    s.tasks ? `${s.tasks} background ${s.tasks === 1 ? 'task' : 'tasks'}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return Menu.buildFromTemplate([
    { label: summary, enabled: false },
    { type: 'separator' },
    { label: 'Show Mission Control', accelerator: deps!.hotkey() || undefined, click: () => deps!.showWindow() },
    { label: 'New task…', click: () => deps!.navigate({ view: 'tasks', newTask: true }) },
    { label: 'Task board', click: () => deps!.navigate({ view: 'tasks' }) },
    { label: 'Agents', click: () => deps!.navigate({ view: 'agents' }) },
    { type: 'separator' },
    { label: 'Quit Mission Control', click: () => deps!.quit() }
  ])
}

export function createTray(d: TrayDeps): void {
  deps = d
  const icon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png')).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Mission Control')
  tray.on('click', () => deps!.showWindow())
  // Rebuild the menu on open so the status line is current.
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()))
  refreshTray()
}

export function refreshTray(): void {
  if (!tray || !deps) return
  const s = deps.status()
  const parts = [`${s.agents} open`]
  if (s.attention) parts.push(`${s.attention} need you`)
  if (s.tasks) parts.push(`${s.tasks} tasks`)
  tray.setToolTip(`Mission Control: ${parts.join(', ')}`)
}

/** Registers the global hotkey; returns an error message if it can't be used. */
export function setHotkey(accelerator: string): string | null {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = ''
  }
  if (!accelerator.trim()) return null
  try {
    const ok = globalShortcut.register(accelerator, toggleWindow)
    if (!ok) return `${accelerator} is already used by another app. Pick another shortcut.`
    registered = accelerator
    return null
  } catch {
    return `"${accelerator}" isn't a valid shortcut. Use something like Ctrl+Alt+M.`
  }
}

export function destroyTray(): void {
  globalShortcut.unregisterAll()
  tray?.destroy()
  tray = null
}

app.on('will-quit', () => globalShortcut.unregisterAll())
