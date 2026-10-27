import { stopAllProjectCommands } from './projectCommands'
import { app, BrowserWindow } from 'electron'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { flushTasks, initTasks, runningTaskCount, stopAllTasks } from './tasks'
import { createTray, destroyTray, refreshTray, setHotkey } from './tray'
import { startScheduler, stopScheduler } from './templates'
import { initUpdater } from './updater'
import { setFolderSource } from './claudeData'
import { queryIndex, startIndexer, stopIndexer } from './indexer'
import { checkBudgetWarnings } from './budget'
import { startHookServer, stopHookServer } from './hookServer'
import { killAllTerminals } from './pty'
import { loadStore, updateStore } from './store'
import { saveNewBriefings } from './briefings'
import { log as smokeLog, perfMark, runSmoke } from './smoke'
import { startPlanUsage, stopPlanUsage } from './planUsage'
import { stopVaultWatch } from './vault'
import { coachPrompt } from './eco'
import { listDocs } from './docs'
import { hookTaps, launchTerminal, ptyTaps } from './terminals'
import { registerIpc, uiSummary } from './ipc'
import { createWindow, getMainWindow, sendToWindow, setQuitting, showWindow } from './window'
import { briefingSaved, budgetWarning, checkChatCosts, checkPlanLimits, notifyDueReminders, notifyTasks, showDigest } from './notify'

// The app's lifecycle: startup wiring and shutdown. The window lives in window.ts, the IPC
// handlers in ipc.ts, desktop notifications in notify.ts.

// Self-tests run in their own profile, starting from a copy of your settings: they work while the
// installed app is open (Chromium can't share a profile) and never change its data.
if (process.env.MC_SMOKE) {
  const real = process.env.MC_SMOKE_PROFILE ? undefined : app.getPath('userData')
  const own = process.env.MC_SMOKE_PROFILE || `${real} (self-test)`
  mkdirSync(own, { recursive: true })
  try {
    if (!process.env.MC_SMOKE_CLEAN && real) copyFileSync(join(real, 'store.json'), join(own, 'store.json'))
  } catch {
    /* no settings yet */
  }
  app.setPath('userData', own)
  if (process.env.MC_SMOKE_CLEAN) updateStore(s => { s.settings.userName = 'Developer'; s.settings.autoUpdate = false; s.settings.queueEnabled = false; s.settings.autoBriefings = false; s.settings.hotkey = '' })
  if (process.env.MC_SMOKE_PERF === 'fresh') for (const ext of ['', '-wal', '-shm']) rmSync(join(own, `index-perf.db${ext}`), { force: true })
}
perfMark('main loaded')

app.setAppUserModelId('com.brawly0.missioncontrol') // needed for Windows toast notifications

// One instance: opening the shortcut again brings back the running app (it may be in the tray).
if (!process.env.MC_SMOKE && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

app.whenReady().then(async () => {
  perfMark('ready')
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
      const win = getMainWindow()
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
  perfMark('window created')
  setFolderSource((ids) => queryIndex('sessionFolders', ids))
  // Due-date reminders and the daily digest, checked every minute.
  setInterval(() => {
    if (!process.env.MC_SMOKE) void showDigest()
    notifyDueReminders()
  }, 60_000)
  let lastIndexRun = 0
  // A digest that came due while the app was closed shows shortly after it starts.
  setTimeout(() => void showDigest(), 30_000)
  startIndexer((status) => {
    sendToWindow('index:status', status)
    if (status.lastRun && status.lastRun !== lastIndexRun) {
      lastIndexRun = status.lastRun
      void checkChatCosts()
      void saveNewBriefings(briefingSaved)
    }
  })
  // The plan poll starts after the indexer: it saves readings there and reads the last hour back.
  if (!process.env.MC_SMOKE) startPlanUsage(checkPlanLimits)
  if (!process.env.MC_SMOKE) {
    createTray({
      getWindow: getMainWindow,
      showWindow,
      navigate: (target) => {
        showWindow()
        sendToWindow('navigate', target)
      },
      quit: () => app.quit(),
      status: () => ({ agents: uiSummary().agents, attention: uiSummary().attention, tasks: runningTaskCount() }),
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
  const win = getMainWindow()
  if (process.env.MC_SMOKE && win) {
    win.webContents.once('did-finish-load', () => runSmoke(win, process.env.MC_SMOKE!, { launchTerminal, ptyTaps, hookTaps, listDocs }))
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** The quit test (MC_SMOKE_QUIT) logs how long each step of quitting takes. */
const quitStart = { at: 0 }
const quitStage = (name: string) => {
  if (!process.env.MC_SMOKE_QUIT) return
  if (!quitStart.at) quitStart.at = Date.now()
  smokeLog(`quit stage: ${name} +${Date.now() - quitStart.at}ms`)
}
app.on('will-quit', () => quitStage('will-quit'))
app.on('quit', () => quitStage('quit'))
process.on('exit', () => quitStage('process exit'))

app.on('before-quit', () => {
  quitStage('before-quit')
  setQuitting()
  stopAllTasks()
  stopAllProjectCommands()
  flushTasks()
  // Stops the agents' programs and terminates the terminal host (ADR 0018); quick even with busy terminals.
  killAllTerminals()
  quitStage('terminals stopped')
  stopHookServer()
  stopIndexer()
  stopScheduler()
  stopPlanUsage()
  stopVaultWatch()
  destroyTray()
  quitStage('before-quit done')
})
app.on('window-all-closed', () => {
  quitStage('window-all-closed')
  setQuitting()
  if (process.platform !== 'darwin') app.quit()
})
