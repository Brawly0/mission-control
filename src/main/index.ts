import { app, BrowserWindow, dialog, ipcMain, Notification, screen, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AppSettings,
  BudgetState,
  DocFile,
  HookEvent,
  NewTask,
  Schedule,
  TemplateInput,
  ProjectMeta,
  RateLimitInfo,
  Note,
  SavedAgent,
  SearchHit,
  Task,
  TaskColumn,
  TaskRun,
  TerminalInfo,
  TerminalSpec,
  UiState,
  UsageReport,
  WorktreeInfo
} from '../shared/types'
import { automationHold, takeDueReminders, createTask,
  deleteTask,
  followUpTask,
  rerunChecks,
  flushTasks,
  getRateLimit,
  initTasks,
  listTasks,
  pumpQueue,
  queueStatus,
  runningTaskCount,
  setTaskRun,
  startTask,
  stopAllTasks,
  stopTask,
  updateTask
} from './tasks'
import { createTray, destroyTray, refreshTray, setHotkey } from './tray'
import { deleteTemplate, listTemplates, runTemplate, saveTemplate, startScheduler, stopScheduler } from './templates'
import { checkForUpdates, initUpdater, installUpdate, setAutoCheck, updateStatus } from './updater'
import { getSession, listProjects, listSessions, normalizePath, recentSessions, renameSession, sessionExists, setProjectMeta, setFolderSource, moveSession, movedChatList } from './claudeData'
import { indexStatus, queryIndex, reindex, startIndexer, stopIndexer } from './indexer'
import { commitAll, createWorktree, getChanges, gitInfoMany, initGit, mergeWorktree, previewGitInit, removeWorktree } from './git'
import { allBudgets, checkBudgetWarnings } from './budget'
import { hookSettingsFor, removeHookSettings, startHookServer, stopHookServer } from './hookServer'
import { agentEnv, killAllTerminals, killTerminal, killTerminalsIn, resizeTerminal, spawnTerminal, terminalCount, writeTerminal, whichSync } from './pty'
import { loadStore, updateStore, type WindowBounds } from './store'
import { worktreeParent } from '../shared/projectLook'
import { contextUsage, launchArgs, startupReport } from './spend'
import { addSummaryInstructions, hasSummaryInstructions, latestBriefing, listBriefings, saveBriefing, saveNewBriefings } from './briefings'
import { claudeStatus, createProject, deleteNote, invalidateKnowledge, knowledgeDocs, listNotes, quickChatFolder, saveNote, searchKnowledge, userName } from './hub'
import { runSmoke } from './smoke'
import { refreshPlanUsage, startPlanUsage, stopPlanUsage } from './planUsage'
import { buildVault, stopVaultWatch, vaultNotes, watchVault } from './vault'
import { addEcoSkillToProject, listSkills } from './skills'
import { coachPrompt, ecoPluginDir } from './eco'
import { windowLabel } from '../shared/planUsage'

let mainWindow: BrowserWindow | null = null
let toldAboutTray = false
/** Live counts pushed by the UI, for the tray tooltip and menu. */
let uiSummary = { agents: 0, attention: 0 }

function showWindow(): void {
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

  // Coming back to the window: fresh plan numbers (at most every 20 seconds).
  mainWindow.on('focus', () => {
    if (!process.env.MC_SMOKE) void refreshPlanUsage()
  })
  mainWindow.on('close', (e) => {
    const win = mainWindow
    if (!win || process.env.MC_SMOKE) return
    const b = win.getNormalBounds()
    updateStore((s) => {
      s.window = { ...b, maximized: win.isMaximized() }
    })
    // With work still running, closing hides to the tray instead of stopping everything.
    const busy = terminalCount() > 0 || runningTaskCount() > 0
    if (!quitting && busy && loadStore().settings.closeToTray) {
      e.preventDefault()
      win.hide()
      if (!toldAboutTray) {
        toldAboutTray = true
        new Notification({
          title: 'Mission Control is still running',
          body: 'Your agents and tasks keep going. Open it from the tray icon, or quit from its menu.',
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
function sendToWindow(channel: string, ...args: unknown[]): void {
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, ...args)
}

const DOC_NAMES = ['CLAUDE.md', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CHANGELOG.md']

export async function listDocs(projectPath: string): Promise<DocFile[]> {
  const docs: DocFile[] = []
  for (const name of DOC_NAMES) {
    const p = join(projectPath, name)
    try {
      if ((await fs.stat(p)).isFile()) docs.push({ name, path: p })
    } catch {
      /* not present */
    }
  }
  // docs/briefings/ holds session briefings (saved automatically when a chat runs out of room).
  for (const dir of ['docs', 'docs/briefings', '.claude']) {
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
    // The project's default model for new chats, and only the MCP servers it loads.
    args = [...launchArgs(spec.cwd, { newChat: resumeAt < 0 && !args.includes('--continue'), hasModel: args.includes('--model') }), ...args]
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
  ipcMain.handle('sessions:list', (_e, key: string | string[], path?: string) => listSessions(key, path))
  ipcMain.handle('sessions:move', (_e, id: string, path: string) => moveSession(id, path))
  ipcMain.handle('spend:context', (_e, ids: string[]) => contextUsage(ids))
  ipcMain.on('ui:zoom', (e, factor: number) => e.sender.setZoomFactor(Math.min(1.6, Math.max(0.7, Number(factor) || 1))))
  ipcMain.handle('spend:startup', async (_e, path: string, keys: string[]) => {
    const first = await queryIndex<{ tokens: number; model: string }[]>('firstReplies', keys).catch(() => [])
    return startupReport(path, first)
  })
  ipcMain.handle('sessions:rename', (_e, id: string, title: string) => renameSession(id, title))
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
  ipcMain.handle('docs:write', async (_e, file: string, content: string) => {
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, content, 'utf8')
    invalidateKnowledge()
  })
  ipcMain.handle('dialog:folder', async (_e, title?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('projects:create', (_e, opts: { parent: string; name: string; claudeMd: boolean; git: boolean }) => createProject(opts))
  ipcMain.handle('chat:quickFolder', () => quickChatFolder())
  ipcMain.handle('notes:list', () => listNotes())
  ipcMain.handle('notes:save', (_e, note: Partial<Note>) => saveNote(note))
  ipcMain.handle('notes:delete', (_e, id: string) => deleteNote(id))
  ipcMain.handle('skills:list', async () => listSkills((await listProjects()).map((p) => p.path), ecoPluginDir()))
  ipcMain.handle('skills:usage', (_e, since: number) => queryIndex('skillUsage', since))
  ipcMain.handle('skills:addEco', (_e, path: string) => addEcoSkillToProject(path))
  ipcMain.handle('vault:notes', (_e, path: string) => vaultNotes(path))
  ipcMain.handle('vault:build', (_e, path: string, name: string, mode: 'build' | 'update', model?: string) => buildVault(path, name, mode, model))
  ipcMain.on('vault:watch', (_e, path: string | null) => watchVault(path, (p) => sendToWindow('vault:changed', p)))
  ipcMain.handle('knowledge:list', () => knowledgeDocs(listDocs))
  ipcMain.handle('knowledge:search', (_e, q: string) => searchKnowledge(q, listDocs))
  ipcMain.handle('claude:status', (_e, force?: boolean) => claudeStatus(!!force))
  ipcMain.handle('user:name', () => userName())
  ipcMain.handle('briefings:list', () => listBriefings())
  ipcMain.handle('briefings:save', (_e, id: string, at: number) => saveBriefing(id, at))
  ipcMain.handle('briefings:latest', (_e, path: string) => latestBriefing(path))
  ipcMain.handle('briefings:hasInstructions', (_e, path: string) => hasSummaryInstructions(path))
  ipcMain.handle('briefings:addInstructions', (_e, path: string) => addSummaryInstructions(path))
  ipcMain.handle('folders:common', () => ({ desktop: app.getPath('desktop'), documents: app.getPath('documents'), home: app.getPath('home') }))

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
  // Usage from a project's worktrees counts toward the project, matching how the sidebar lists chats.
  const foldWorktrees = (rows: UsageReport['byProject']): UsageReport['byProject'] => {
    const out = new Map<string, UsageReport['byProject'][number]>()
    for (const r of rows) {
      const path = worktreeParent(r.projectPath)?.parent ?? r.projectPath
      const id = normalizePath(path || r.projectKey)
      const cur = out.get(id)
      if (!cur) {
        out.set(id, { ...r, projectPath: path })
        continue
      }
      const sum = cur as unknown as Record<string, unknown>
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') sum[k] = ((sum[k] as number) ?? 0) + v
    }
    return [...out.values()].sort((a, b) => b.cost - a.cost)
  }
  // Chat titles you set in Mission Control live in the store, not the index.
  const ownTitles = <T extends { sessionId: string; title: string }>(rows: T[]): T[] => {
    const titles = loadStore().chatTitles
    return rows.map((r) => (titles[r.sessionId] ? { ...r, title: titles[r.sessionId] } : r))
  }
  ipcMain.handle('index:search', async (_e, query: string, opts?: object) =>
    ownTitles((await queryIndex('search', query, opts ?? {})) as SearchHit[])
  )
  ipcMain.handle('index:usage', async (_e, since: number) => {
    const report = (await queryIndex('usageReport', since)) as UsageReport
    // Chats shown under another project (started from C:\, or moved by you) count toward that project.
    const moved = movedChatList()
    let byProject = report.byProject
    if (moved.length) {
      const totals = (await queryIndex('sessionTotals', since, moved.map((m) => m.id))) as (UsageReport['byProject'][number] & { sessionId: string })[]
      const target = new Map(moved.map((m) => [m.id, m.path]))
      const shift = (row: UsageReport['byProject'][number], t: Record<string, unknown>, sign: number) => {
        const r = row as unknown as Record<string, unknown>
        for (const [k, v] of Object.entries(t)) if (typeof v === 'number' && typeof r[k] === 'number') r[k] = (r[k] as number) + sign * v
      }
      byProject = byProject.map((r) => ({ ...r }))
      for (const t of totals) {
        const from = byProject.find((r) => r.projectKey === t.projectKey)
        const { sessionId, projectKey: _k, projectPath: _p, ...nums } = t
        if (from) shift(from, nums, -1)
        byProject.push({ ...(nums as UsageReport['byProject'][number]), projectKey: '', projectPath: target.get(sessionId) ?? '', sessions: 1 })
      }
      byProject = byProject.filter((r) => r.cost > 0.0001 || (r.sessions ?? 0) > 0)
    }
    return { ...report, byProject: foldWorktrees(byProject), topSessions: ownTitles(report.topSessions) }
  })
  ipcMain.handle('index:sessionUsage', (_e, key: string | string[]) => queryIndex('sessionUsage', key))
  ipcMain.handle('index:status', () => indexStatus())
  ipcMain.on('index:run', () => reindex())

  ipcMain.handle('tasks:list', () => listTasks())
  ipcMain.handle('tasks:create', (_e, t: NewTask) => createTask(t))
  ipcMain.handle('tasks:update', (_e, id: string, patch: Partial<Task>) => updateTask(id, patch))
  ipcMain.handle('tasks:delete', (_e, id: string) => deleteTask(id))
  ipcMain.handle('tasks:start', (_e, id: string) => startTask(id))
  ipcMain.handle('tasks:stop', (_e, id: string) => stopTask(id))
  ipcMain.handle('tasks:setRun', (_e, id: string, patch: Partial<TaskRun>, column?: TaskColumn) => setTaskRun(id, patch, column))
  ipcMain.handle('ratelimit:get', () => getRateLimit())
  ipcMain.handle('ratelimit:refresh', async () => {
    await refreshPlanUsage(true)
    return getRateLimit()
  })

  ipcMain.handle('settings:get', () => loadStore().settings)
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const next = { ...loadStore().settings, ...patch }
    const error = patch.hotkey !== undefined ? setHotkey(next.hotkey) : null
    if (error) {
      // Keep the old, working shortcut.
      setHotkey(loadStore().settings.hotkey)
      return error
    }
    updateStore((s) => {
      s.settings = next
    })
    if (patch.autoUpdate !== undefined) setAutoCheck(next.autoUpdate)
    if (patch.queueEnabled !== undefined || patch.queueParallel !== undefined || patch.queuePauseAtPercent !== undefined) void pumpQueue()
    return null
  })

  ipcMain.handle('queue:status', () => queueStatus())
  ipcMain.handle('tasks:followUp', (_e, id: string, prompt: string) => followUpTask(id, prompt))
  ipcMain.handle('tasks:rerunChecks', (_e, id: string) => rerunChecks(id))
  ipcMain.handle('git:previewInit', (_e, folder: string) => previewGitInit(folder))
  ipcMain.handle('git:init', (_e, folder: string) => initGit(folder))
  ipcMain.handle('budgets:all', () => allBudgets())
  ipcMain.handle('templates:list', () => listTemplates())
  ipcMain.handle('templates:save', (_e, t: TemplateInput, id?: string) => saveTemplate(t, id))
  ipcMain.handle('templates:delete', (_e, id: string) => deleteTemplate(id))
  ipcMain.handle('templates:run', (_e, id: string, then: Schedule['then'], projectPath?: string) => runTemplate(id, then, projectPath))

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.on('update:install', () => {
    quitting = true
    installUpdate()
  })
  ipcMain.on('status:summary', (_e, summary: { agents: number; attention: number }) => {
    uiSummary = summary
    refreshTray()
  })

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

/** A Windows notification that opens the task board when clicked. */
/** One notification per chat per day when a chat's estimated cost today passes the limit in Settings. */
async function checkChatCosts(): Promise<void> {
  const limit = loadStore().settings.chatCostAlertUsd
  if (!limit || process.env.MC_SMOKE) return
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const day = midnight.toLocaleDateString('sv')
  const over = await queryIndex<{ sessionId: string; title: string; projectPath: string; cost: number }[]>('chatsOverCost', midnight.getTime(), limit).catch(() => [])
  const seen = loadStore().costAlerted
  const done = new Set(seen.day === day ? seen.ids : [])
  const fresh = over.filter((c) => !done.has(c.sessionId))
  if (!fresh.length) return
  updateStore((s) => {
    s.costAlerted = { day, ids: [...done, ...fresh.map((c) => c.sessionId)] }
  })
  const moved = new Map(movedChatList().map((m) => [m.id, m.path]))
  for (const c of fresh.slice(0, 3)) {
    const n = new Notification({
      title: `"${c.title.slice(0, 60)}" has cost about $${c.cost.toFixed(2)} today`,
      body: 'Long chats re-read their whole history on every reply. Compacting it or starting fresh with a summary is cheaper. (Estimated at API prices.)',
      icon: join(__dirname, '../../build/icon.png')
    })
    n.on('click', () => {
      showWindow()
      sendToWindow('navigate', { view: 'project', chat: { projectPath: moved.get(c.sessionId) ?? c.projectPath, sessionId: c.sessionId } })
    })
    n.show()
  }
}

/** After a compaction in a project with "keep docs up to date" on, Claude refreshes its vault (unless automation is on hold). */
async function autoUpdateVault(projectPath: string, projectName: string): Promise<void> {
  if (!loadStore().projectMeta[normalizePath(projectPath)]?.autoDocs) return
  if (await automationHold(projectPath)) return
  const info = await vaultNotes(projectPath).catch(() => null)
  if (!info?.hasIndex) return
  await buildVault(projectPath, projectName, 'update').catch(() => undefined)
}

/** One notification per plan window when it passes your alert level, and one when it runs out. */
function checkPlanLimits(info: RateLimitInfo): void {
  const level = loadStore().settings.planAlertPercent
  if (!level) return
  const shown = new Set(loadStore().limitAlerted)
  for (const w of info.windows) {
    const pct = Math.round(w.utilization * 100)
    // "pace": not there yet, but heading to run out soon (within the hour for the session, a day for a week).
    const soon = w.name === 'five_hour' ? 3_600_000 : 86_400_000
    const pace = !!w.forecast?.runsOutAt && w.forecast.runsOutAt - info.at < soon
    const kind = pct >= 100 ? 'out' : pct >= level ? 'near' : pace ? 'pace' : ''
    // A reading's reset time wobbles by milliseconds; key on the minute.
    const key = `${w.name}@${Math.round(w.resetsAt / 60_000)}:${kind}`
    if (!kind || shown.has(key)) continue
    updateStore((s) => {
      s.limitAlerted = [...s.limitAlerted, key].slice(-20)
    })
    const resets = w.resetsAt ? new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon'
    const n = new Notification({
      title:
        kind === 'out'
          ? `${windowLabel(w.name, true)} limit reached`
          : kind === 'pace'
            ? `${windowLabel(w.name, true)} limit runs out ~${new Date(w.forecast!.runsOutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} at this pace`
            : `${windowLabel(w.name, true)} limit at ${pct}%`,
      body: kind === 'out' ? `Claude is paused until it resets (${resets}).` : `${pct}% used, resets ${resets}. Smaller models and fresh chats make what's left go further.`,
      icon: join(__dirname, '../../build/icon.png')
    })
    n.on('click', () => {
      showWindow()
      sendToWindow('navigate', { view: 'usage' })
    })
    n.show()
  }
}

function notifyTasks(title: string, body: string): void {
  if (process.env.MC_SMOKE) return
  const n = new Notification({ title, body, icon: join(__dirname, '../../build/icon.png') })
  n.on('click', () => {
    showWindow()
    sendToWindow('navigate', { view: 'tasks' })
  })
  n.show()
}

function budgetWarning(projectPath: string, state: BudgetState): void {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath
  const n = new Notification({
    title: state.over ? `${name} is over its monthly budget` : `${name} has used ${Math.round(state.ratio * 100)}% of its monthly budget`,
    body: `About $${state.spent.toFixed(2)} of $${state.budget} this month (estimated at API prices).${state.over ? ' Automation for this project is on hold.' : ''}`,
    icon: join(__dirname, '../../build/icon.png')
  })
  n.on('click', () => {
    showWindow()
    sendToWindow('navigate', { view: 'usage' })
  })
  if (!process.env.MC_SMOKE) n.show()
  sendToWindow('budgets:changed')
}

app.setAppUserModelId('com.brawly0.missioncontrol') // needed for Windows toast notifications

// One instance: opening the shortcut again brings back the running app (it may be in the tray).
if (!process.env.MC_SMOKE && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

app.whenReady().then(async () => {
  await startHookServer(
    (event) => {
      sendToWindow('hook:event', event)
      hookTaps.forEach((tap) => tap(event))
    },
    (sessionId) => coachPrompt(sessionId)
  )
  registerIpc()
  initTasks({
    onChange: (list) => {
      sendToWindow('tasks:changed', list)
      refreshTray()
    },
    onRateLimit: (info) => sendToWindow('ratelimit', info),
    onQueueStatus: (status) => sendToWindow('queue:status', status),
    onFinished: (task) => {
      const win = mainWindow
      void checkBudgetWarnings(budgetWarning)
      if (win && win.isVisible() && win.isFocused()) return
      const checks = task.run?.checks
      const body = task.run?.error
        ? `Stopped: ${task.run.error.slice(0, 120)}`
        : checks?.status === 'failed' || checks?.status === 'error'
          ? `Finished, but checks failed (${checks.command}).`
          : checks?.status === 'passed'
            ? 'Finished and checks passed. Ready for review.'
            : 'Task finished. Ready for review.'
      notifyTasks(task.title, body)
    },
    onReady: (task) => notifyTasks(`Ready: ${task.title}`, 'The tasks it waited on succeeded. Open it to start (it runs interactively).')
  })
  // Budget warnings: now and then, and after every task (above).
  setTimeout(() => void checkBudgetWarnings(budgetWarning), 20_000)
  setInterval(() => void checkBudgetWarnings(budgetWarning), 10 * 60_000)
  createWindow()
  if (!process.env.MC_SMOKE) startPlanUsage(checkPlanLimits)
  setFolderSource((ids) => queryIndex('sessionFolders', ids))
  // Due-date reminders, checked every minute.
  setInterval(() => {
    for (const t of takeDueReminders().slice(0, 3)) {
      if (process.env.MC_SMOKE) continue
      const n = new Notification({ title: `Due now: ${t.title}`, body: t.projectName, icon: join(__dirname, '../../build/icon.png') })
      n.on('click', () => {
        showWindow()
        sendToWindow('navigate', { view: 'tasks', taskId: t.id })
      })
      n.show()
    }
  }, 60_000)
  let lastIndexRun = 0
  startIndexer((status) => {
    sendToWindow('index:status', status)
    if (status.lastRun && status.lastRun !== lastIndexRun) {
      lastIndexRun = status.lastRun
      void checkChatCosts()
      void saveNewBriefings((b, file) => {
        if (process.env.MC_SMOKE) return
        void autoUpdateVault(b.projectPath, b.projectName)
        const n = new Notification({ title: 'Session briefing saved', body: `${b.title || 'A chat'} (${b.projectName}) · ${file.split(/[\\/]/).slice(-3).join('/')}`, icon: join(__dirname, '../../build/icon.png') })
        n.on('click', () => shell.openPath(file))
        n.show()
      })
    }
  })
  if (!process.env.MC_SMOKE) {
    createTray({
      getWindow: () => mainWindow,
      showWindow,
      navigate: (target) => {
        showWindow()
        sendToWindow('navigate', target)
      },
      quit: () => app.quit(),
      status: () => ({ agents: uiSummary.agents, attention: uiSummary.attention, tasks: runningTaskCount() }),
      hotkey: () => loadStore().settings.hotkey
    })
    const hotkeyError = setHotkey(loadStore().settings.hotkey)
    if (hotkeyError) console.warn(hotkeyError)
    initUpdater((s) => sendToWindow('update:status', s), loadStore().settings.autoUpdate)
  }
  // Self-tests connect templates to the UI but never run the timer: they must not fire the user's recurring tasks.
  startScheduler(
    {
      onChange: (list) => sendToWindow('templates:changed', list),
      onLaunchInteractive: (taskId) => {
        showWindow()
        sendToWindow('task:launch', taskId)
      },
      onFired: (tpl, task) =>
        notifyTasks(`Recurring task: ${tpl.name}`, task.mode === 'headless' && tpl.schedule?.then === 'start' ? 'Started in the background.' : 'Added to your task board.'),
      onSkipped: (tpl, reason) => notifyTasks(`Skipped: ${tpl.name}`, `${reason}. It will try again at its next scheduled time.`)
    },
    !process.env.MC_SMOKE
  )
  if (process.env.MC_SMOKE && mainWindow) {
    const win = mainWindow
    win.webContents.once('did-finish-load', () => runSmoke(win, process.env.MC_SMOKE!, { launchTerminal, ptyTaps, hookTaps, listDocs }))
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
  stopAllTasks()
  flushTasks()
  killAllTerminals()
  stopHookServer()
  stopIndexer()
  stopScheduler()
  stopPlanUsage()
  stopVaultWatch()
  destroyTray()
})
app.on('window-all-closed', () => {
  quitting = true
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})
