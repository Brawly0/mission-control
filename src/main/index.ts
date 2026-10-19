import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DocFile, HookEvent, SavedAgent, TerminalInfo, TerminalSpec } from '../shared/types'
import { getSession, listProjects, listSessions, normalizePath, sessionExists } from './claudeData'
import { hookSettingsFor, removeHookSettings, startHookServer, stopHookServer } from './hookServer'
import { agentEnv, killAllTerminals, killTerminal, resizeTerminal, spawnTerminal, writeTerminal, whichSync } from './pty'
import { loadStore, updateStore } from './store'
import { runSmoke } from './smoke'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Mission Control',
    backgroundColor: '#0f1115',
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
})
app.on('window-all-closed', () => {
  quitting = true
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})
