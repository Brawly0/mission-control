import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DocFile, HookEvent, ProjectMeta, SavedAgent, TerminalInfo, TerminalSpec, UiState, WorktreeInfo } from '../shared/types'
import { getSession, listProjects, listSessions, normalizePath, recentSessions, sessionExists, setProjectMeta } from './claudeData'
import { indexStatus, queryIndex, reindex, startIndexer, stopIndexer } from './indexer'
import { commitAll, createWorktree, getChanges, gitInfoMany, mergeWorktree, removeWorktree } from './git'
import { hookSettingsFor, removeHookSettings, startHookServer, stopHookServer } from './hookServer'
import { agentEnv, killAllTerminals, killTerminal, killTerminalsIn, resizeTerminal, spawnTerminal, writeTerminal, whichSync } from './pty'
import { loadStore, updateStore, type WindowBounds } from './store'
import { runSmoke } from './smoke'

let mainWindow: BrowserWindow | null = null

/** Last window position and size, if it still fits on a connected screen. */
function savedBounds(): WindowBounds | undefined {
  if (process.env.MC_SMOKE) return undefined
  const b = loadStore().window
  if (!b) return undefined
  const area = screen.getDisplayMatching(b).workArea
  const visible = b.x < area.x + area.width - 100 && b.y < area.y + area.height - 100 && b.x + b.width > area.x + 100 && b.y >= area.y - 20
  return visible ? b : undefined
}

function createWindow(): void {
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

  mainWindow.on('close', () => {
    const win = mainWindow
    if (!win || process.env.MC_SMOKE) return
    const b = win.getNormalBounds()
    updateStore((s) => {
      s.window = { ...b, maximized: win.isMaximized() }
    })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Sends to the renderer only while it still exists. Terminals keep emitting output for a
 * moment after the window closes; sending to a destroyed window throws in the main process.
 */
function sendToWindow(channel: string, ...args: unknown[]): void {
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, ...args)
}

const DOC_NAMES = ['CLAUDE.md', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CHANGELOG.md']

async function listDocs(projectPath: string): Promise<DocFile[]> {
  const docs: DocFile[] = []
  for (const name of DOC_NAMES) {
    const p = join(projectPath, name)
    try {
      if ((await fs.stat(p)).isFile()) docs.push({ name, path: p })
    } catch {
      /* not present */
    }
  }
  for (const dir of ['docs', '.claude']) {
    try {
      const entries = await fs.readdir(join(projectPath, dir), { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          docs.push({ name: `${dir}/${e.name}`, path: join(projectPath, dir, e.name) })
        }
      }
    } catch {
      /* folder missing */
    }
  }
  return docs
}

/** Starts a terminal; claude terminals get hook reporting and a known session id. */
export function launchTerminal(spec: TerminalSpec): TerminalInfo {
  const id = randomUUID()
  let sessionId: string | undefined
  let args = spec.args
  if (spec.kind === 'claude') {
    const resumeAt = args.indexOf('--resume')
    if (resumeAt >= 0) {
      sessionId = args[resumeAt + 1]
    } else if (!args.includes('--continue')) {
      // Choosing the id up front lets the app restore this exact session later.
      sessionId = randomUUID()
      args = ['--session-id', sessionId, ...args]
    }
    args = ['--settings', hookSettingsFor(id), ...args]
  }
  const info = spawnTerminal(
    { ...spec, args },
    {
      data: (tid, data) => {
        sendToWindow('pty:data', tid, data)
        ptyTaps.forEach((tap) => tap.data?.(tid, data))
      },
      exit: (tid, code) => {
        removeHookSettings(tid)
        sendToWindow('pty:exit', tid, code)
        ptyTaps.forEach((tap) => tap.exit?.(tid, code))
      }
    },
    id
  )
  return { ...info, sessionId }
}

/** Extra observers of terminal output and hook events (used by the smoke test). */
export const ptyTaps = new Set<{ data?: (id: string, d: string) => void; exit?: (id: string, code: number) => void }>()
export const hookTaps = new Set<(e: HookEvent) => void>()

function registerIpc(): void {
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('sessions:list', (_e, key: string) => listSessions(key))
  ipcMain.handle('sessions:get', (_e, key: string, id: string) => getSession(key, id))

  ipcMain.handle('projects:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    updateStore((s) => {
      if (!s.manualProjects.some((p) => normalizePath(p) === normalizePath(path))) s.manualProjects.push(path)
    })
    return path
  })
  ipcMain.handle('projects:remove', (_e, path: string) => {
    updateStore((s) => {
      s.manualProjects = s.manualProjects.filter((p) => normalizePath(p) !== normalizePath(path))
    })
  })
  ipcMain.handle('projects:togglePin', (_e, path: string) => {
    updateStore((s) => {
      const norm = normalizePath(path)
      s.pinned = s.pinned.some((p) => normalizePath(p) === norm)
        ? s.pinned.filter((p) => normalizePath(p) !== norm)
        : [...s.pinned, path]
    })
  })

  ipcMain.handle('docs:list', (_e, projectPath: string) => listDocs(projectPath))
  ipcMain.handle('docs:read', (_e, file: string) => fs.readFile(file, 'utf8'))
  ipcMain.handle('docs:write', (_e, file: string, content: string) => fs.writeFile(file, content, 'utf8'))

  ipcMain.handle('open:explorer', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('open:vscode', (_e, path: string) => {
    spawn('code', [path], { shell: true, detached: true, stdio: 'ignore' }).unref()
  })
  ipcMain.handle('open:terminal', (_e, cwd: string, args: string[]) => {
    // Opens Windows Terminal in the folder running claude, outside the app.
    const wt = whichSync('wt')
    const claudeArgs = ['claude', ...args]
    if (wt) {
      spawn(wt, ['-d', cwd, ...claudeArgs], { detached: true, stdio: 'ignore', env: agentEnv() }).unref()
    } else {
      spawn('cmd.exe', ['/c', 'start', 'powershell', '-NoExit', '-Command', claudeArgs.join(' ')], {
        cwd,
        detached: true,
        env: agentEnv(),
        stdio: 'ignore'
      }).unref()
    }
  })

  ipcMain.handle('pty:spawn', (_e, spec: TerminalSpec) => launchTerminal(spec))
  ipcMain.on('pty:write', (_e, id: string, data: string) => writeTerminal(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => {
    killTerminal(id)
    removeHookSettings(id)
  })

  ipcMain.on('agents:save', (_e, agents: SavedAgent[]) => {
    // While quitting, terminals exit one by one; don't let that wipe the list we want to restore.
    if (quitting || process.env.MC_SMOKE) return
    updateStore((s) => {
      s.savedAgents = agents
    })
  })
  ipcMain.handle('agents:loadSaved', () => loadStore().savedAgents)
  ipcMain.handle('sessions:exists', (_e, id: string) => sessionExists(id))
  ipcMain.handle('sessions:recent', (_e, limit: number) => recentSessions(limit))

  ipcMain.handle('git:infoMany', (_e, paths: string[]) => gitInfoMany(paths))
  ipcMain.handle('git:createWorktree', (_e, projectPath: string) => createWorktree(projectPath))
  ipcMain.handle('git:changes', (_e, path: string, base?: string) => getChanges(path, base))
  ipcMain.handle('git:commitAll', (_e, path: string, message: string) => commitAll(path, message))
  ipcMain.handle('git:mergeWorktree', (_e, wt: WorktreeInfo) => mergeWorktree(wt))
  ipcMain.handle('git:removeWorktree', async (_e, wt: WorktreeInfo) => {
    // Deleting work is permanent, so the confirmation lives here rather than in the UI.
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Delete worktree', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Discard worktree',
      message: `Delete the worktree and branch "${wt.branch}"?`,
      detail: `${wt.path}\n\nAgents running in it are stopped. Any changes in it that were not merged are lost for good.`
    })
    if (response !== 0) return false
    await killTerminalsIn(wt.path)
    await removeWorktree(wt)
    return true
  })

  ipcMain.handle('projects:setMeta', (_e, path: string, patch: Partial<ProjectMeta>) => setProjectMeta(path, patch))
  ipcMain.handle('index:search', (_e, query: string, opts?: object) => queryIndex('search', query, opts ?? {}))
  ipcMain.handle('index:usage', (_e, since: number) => queryIndex('usageReport', since))
  ipcMain.handle('index:sessionUsage', (_e, key: string) => queryIndex('sessionUsage', key))
  ipcMain.handle('index:status', () => indexStatus())
  ipcMain.on('index:run', () => reindex())

  ipcMain.handle('ui:get', () => loadStore().ui)
  ipcMain.on('ui:set', (_e, patch: Partial<UiState>) => {
    if (process.env.MC_SMOKE) return
    updateStore((s) => {
      s.ui = { ...s.ui, ...patch }
    })
  })

  ipcMain.on('window:focus', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

let quitting = false

app.setAppUserModelId('com.brawly0.missioncontrol') // needed for Windows toast notifications

app.whenReady().then(async () => {
  await startHookServer((event) => {
    sendToWindow('hook:event', event)
    hookTaps.forEach((tap) => tap(event))
  })
  registerIpc()
  createWindow()
  startIndexer((status) => sendToWindow('index:status', status))
  if (process.env.MC_SMOKE && mainWindow) {
    const win = mainWindow
    win.webContents.once('did-finish-load', () => runSmoke(win, process.env.MC_SMOKE!, { launchTerminal, ptyTaps, hookTaps }))
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
  killAllTerminals()
  stopHookServer()
  stopIndexer()
})
app.on('window-all-closed', () => {
  quitting = true
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})
