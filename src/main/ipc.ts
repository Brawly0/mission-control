import { readiness } from './readiness'
import { validRequestId } from '../shared/readiness'
import { getGuidedSetup, updateGuidedSetup } from './store'
import { mergeReviewedWorktree, projectReview, startReviewChecks, startCodeReview } from './projectReview'
import { projectBriefing, draftProjectBriefing, saveProjectBriefing } from './projectBriefing'
import { projectCommandReport, projectRuns, startProjectCommand, stopProjectCommand } from './projectCommands'
import { app, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  AgentTool,
  AppSettings,
  NewTask,
  Schedule,
  TemplateInput,
  ProjectMeta,
  Note,
  SavedAgent,
  SearchHit,
  Task,
  TaskColumn,
  TaskRun,
  TerminalSpec,
  UiState,
  UsageReport,
  ClaudeTokenStats,
  VibeStats,
  VibeTime,
  Workspace,
  WorktreeInfo
} from '../shared/types'
import {
  createTask,
  assertTeamWorktreeIdle,
  planTaskTeam,
  finishTaskAgent,
  startTaskTeam,
  stopTaskTeam,
  deleteTask,
  followUpTask,
  rerunChecks,
  getRateLimit,
  listTasks,
  getTaskOutput,
  pumpQueue,
  queueStatus,
  setTaskRun,
  startTask,
  stopTask,
  updateTask
} from './tasks'
import { refreshTray, setHotkey } from './tray'
import { deleteTemplate, listTemplates, runTemplate, saveTemplate } from './templates'
import { checkForUpdates, installUpdate, setAutoCheck, updateNow, updateStatus } from './updater'
import { getSession, listProjects, listSessions, normalizePath, recentSessions, renameSession, sessionExists, setProjectMeta, moveSession, movedChatList } from './claudeData'
import { indexStatus, queryIndex, reindex } from './indexer'
import { commitAll, createWorktree, getChanges, gitInfoMany, initGit, mergeWorktree, previewGitInit, removeWorktree } from './git'
import { allBudgets } from './budget'
import { removeHookSettings } from './hookServer'
import { agentEnv, killTerminal, killTerminalsIn, resizeTerminal, writeTerminal, whichSync } from './pty'
import { loadStore, updateStore } from './store'
import { worktreeParent } from '../shared/projectLook'
import { contextUsage, startupReport } from './spend'
import { addSummaryInstructions, hasSummaryInstructions, latestBriefing, listBriefings, saveBriefing } from './briefings'
import { codexStatus, claudeStatus, createProject, deleteNote, invalidateKnowledge, knowledgeDocs, listNotes, quickChatFolder, saveNote, searchKnowledge, userName } from './hub'
import { refreshPlanUsage } from './planUsage'
import { planRate } from './planCost'
import { buildDigest } from './digest'
import { nameChats, sessionRecap, summarizeChat } from './recap'
import { deletePromptResource, deletePromptSnippet, importResourceFiles, importResourceFromUrl, listPromptResources, listPromptSnippets, promptStudioChat, savePromptResource, savePromptSnippet } from './promptStudio'
import { buildVault, vaultNotes, watchVault } from './vault'
import { addEcoSkillToProject, listSkills } from './skills'
import { ecoPluginDir } from './eco'
import { listDocs } from './docs'
import { launchTerminal } from './terminals'
import { linkRules, rulesFiles, writeHandoff } from './handoff'
import { codexUsage } from './codexData'
import { getMainWindow, isQuitting, sendToWindow, setQuitting } from './window'

/** Live counts pushed by the UI, for the tray tooltip and menu. */
let summary = { agents: 0, attention: 0 }
export const uiSummary = (): { agents: number; attention: number } => summary

/** Every handler behind the renderer's `window.mc` API (see MissionControlApi in shared/types.ts). */
export function registerIpc(): void {
  const diagnosticRenderers = new WeakSet<Electron.WebContents>()
  const owner = (event: Electron.IpcMainInvokeEvent): number => {
    const id = event.sender.id
    if (!diagnosticRenderers.has(event.sender)) {
      diagnosticRenderers.add(event.sender)
      event.sender.once('destroyed', () => readiness.cancel(id))
      event.sender.on('render-process-gone', () => readiness.cancel(id))
      event.sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) readiness.cancel(id) })
    }
    return id
  }
  ipcMain.handle('setup:get', () => getGuidedSetup())
  ipcMain.handle('setup:update', (_e, patch) => updateGuidedSetup(patch))
  ipcMain.handle('readiness:connections', async (e, request) => {
    // Shell UI fixtures share the setup contract. Onboarding still probes local CLIs.
    if (process.env.MC_SMOKE && process.env.MC_SMOKE_WORKSPACE) {
      await new Promise(resolve => setTimeout(resolve, Number(process.env.MC_SMOKE_PROVIDER_DELAY || 0)))
      if (process.env.MC_SMOKE_CONNECTION_FIXTURE === 'failure') throw new Error('Fixture connection failure')
      const at = Date.now()
      return { requestId: request.requestId, startedAt: at, completedAt: at, outcome: 'ready', suggestions: [], checks: [
        ...request.providers.flatMap((tool: string) => ['installation', 'authentication'].map(kind => ({ id: `${tool}.${kind}`, outcome: 'ready', reason: 'verified', checkedAt: at, action: 'none', explanation: 'Verified by local shell fixture.' }))),
        { id: 'git.installation', outcome: 'ready', reason: 'verified', checkedAt: at, action: 'none', explanation: 'Verified by local shell fixture.' }
      ] }
    }
    return readiness.connections(owner(e), request)
  })
  ipcMain.handle('readiness:project', (e, request) => readiness.project(owner(e), request))
  ipcMain.handle('readiness:cancel', (e, requestId) => {
    if (!validRequestId(requestId)) throw new Error('Invalid readiness request id')
    return readiness.cancel(owner(e), requestId)
  })
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('sessions:list', (_e, key: string | string[], path?: string) => listSessions(key, path))
  ipcMain.handle('review:merge', (_e, wt: WorktreeInfo, fingerprint: string) => { assertTeamWorktreeIdle(wt.path); return mergeReviewedWorktree(wt, fingerprint) })
  ipcMain.handle('review:get', (_e, path: string, base?: string) => projectReview(path, base))
  ipcMain.handle('review:checks', (_e, path: string, base?: string) => startReviewChecks(path, base))
  ipcMain.handle('review:agent', (_e, path: string, base?: string, tool?: 'claude' | 'codex') => startCodeReview(path, base, tool))
  ipcMain.handle('projectBriefing:get', (_e, path: string) => projectBriefing(path))
  ipcMain.handle('projectBriefing:draft', (_e, path: string) => draftProjectBriefing(path))
  ipcMain.handle('projectBriefing:save', (_e, path: string, markdown: string) => saveProjectBriefing(path, markdown))
  ipcMain.handle('projectRuns:report', (_e, id: string) => projectCommandReport(id))
  ipcMain.handle('projectRuns:list', (_e, path: string) => projectRuns(path))
  ipcMain.handle('projectRuns:start', (_e, path: string, id: string, cwd?: string) => startProjectCommand(path, id, cwd))
  ipcMain.handle('projectRuns:stop', (_e, id: string) => stopProjectCommand(id))
  ipcMain.handle('sessions:move', (_e, id: string, path: string) => moveSession(id, path))
  ipcMain.handle('spend:context', (_e, ids: string[]) => contextUsage(ids))
  ipcMain.on('ui:zoom', (e, factor: number) => e.sender.setZoomFactor(Math.min(1.6, Math.max(0.7, Number(factor) || 1))))
  ipcMain.handle('spend:startup', async (_e, path: string, keys: string[]) => {
    const first = await queryIndex<{ tokens: number; model: string }[]>('firstReplies', keys).catch(() => [])
    return startupReport(path, first)
  })
  ipcMain.handle('sessions:rename', (_e, id: string, title: string) => renameSession(id, title))
  ipcMain.handle('sessions:recap', (_e, id: string) => sessionRecap(id))
  ipcMain.handle('sessions:summarize', (_e, id: string) => summarizeChat(id))
  ipcMain.handle('sessions:name', (_e, ids: string[]) => nameChats(ids))
  ipcMain.handle('sessions:get', (_e, key: string, id: string) => getSession(key, id))
  ipcMain.handle('handoff:write', (_e, path: string, from: AgentTool, to: AgentTool, id?: string) => writeHandoff(path, from, to, id))
  ipcMain.handle('handoff:rules', (_e, path: string) => rulesFiles(path))
  ipcMain.handle('handoff:linkRules', (_e, path: string) => linkRules(path))
  ipcMain.handle('codex:usage', (_e, since: number) => {
    if (process.env.MC_SMOKE && process.env.MC_SMOKE_WORKSPACE) return {
      installed: true,
      limits: { at: Date.now(), status: 'allowed', windows: [
        { name: 'five_hour', utilization: 0.06, resetsAt: Date.now() + 3600_000 },
        { name: 'seven_day', utilization: 0.12, resetsAt: Date.now() + 86400_000 }
      ] },
      totals: { input: 0, cachedInput: 0, output: 0, reasoning: 0, sessions: 0 }, byDay: [], byProject: [], byModel: []
    }
    return codexUsage(since)
  })

  ipcMain.handle('projects:addPath', async (_e, path: string) => {
    if (!(await fs.stat(path)).isDirectory()) throw new Error('The project folder no longer exists.')
    updateStore(s => { if (!s.manualProjects.some(p => normalizePath(p) === normalizePath(path))) s.manualProjects.push(path) })
  })
  ipcMain.handle('projects:add', async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, { properties: ['openDirectory'] })
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
    const result = await dialog.showOpenDialog(getMainWindow()!, { title, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('projects:create', (_e, opts: { parent: string; name: string; claudeMd: boolean; git: boolean }) => createProject(opts))
  ipcMain.handle('chat:quickFolder', () => quickChatFolder())
  ipcMain.handle('notes:list', () => listNotes())
  ipcMain.handle('notes:save', (_e, note: Partial<Note>) => saveNote(note))
  ipcMain.handle('notes:delete', (_e, id: string) => deleteNote(id))
  ipcMain.handle('prompts:chat', (_e, req) => promptStudioChat(req))
  ipcMain.handle('prompts:resources', () => listPromptResources())
  ipcMain.handle('prompts:saveResource', (_e, r) => savePromptResource(r))
  ipcMain.handle('prompts:deleteResource', (_e, id: string) => deletePromptResource(id))
  ipcMain.handle('prompts:importUrl', (_e, url: string) => importResourceFromUrl(url))
  ipcMain.handle('prompts:importFiles', () => importResourceFiles())
  ipcMain.handle('prompts:snippets', () => listPromptSnippets())
  ipcMain.handle('prompts:saveSnippet', (_e, s) => savePromptSnippet(s))
  ipcMain.handle('prompts:deleteSnippet', (_e, id: string) => deletePromptSnippet(id))
  ipcMain.handle('skills:list', async () => listSkills((await listProjects()).map((p) => p.path), ecoPluginDir()))
  ipcMain.handle('skills:usage', (_e, since: number) => queryIndex('skillUsage', since))
  ipcMain.handle('skills:addEco', (_e, path: string) => addEcoSkillToProject(path))
  ipcMain.handle('vault:notes', (_e, path: string) => vaultNotes(path))
  ipcMain.handle('vault:build', (_e, path: string, name: string, mode: 'build' | 'update', model?: string) => buildVault(path, name, mode, model))
  ipcMain.on('vault:watch', (_e, path: string | null) => watchVault(path, (p) => sendToWindow('vault:changed', p)))
  ipcMain.handle('knowledge:list', () => knowledgeDocs(listDocs))
  ipcMain.handle('knowledge:search', (_e, q: string) => searchKnowledge(q, listDocs))
  ipcMain.handle('claude:status', (_e, force?: boolean) => claudeStatus(!!force))
  ipcMain.handle('codex:status', (_e, force?: boolean) => codexStatus(!!force))
  ipcMain.handle('projects:reorder', (_e, paths: string[]) => {
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) throw new Error('Invalid project order')
    updateStore(s => {
      [...new Set(paths.map(normalizePath))].forEach((path, sortOrder) => {
        s.projectMeta[path] = { ...(s.projectMeta[path] ?? { tags: [], notes: '' }), sortOrder }
      })
    })
  })
  ipcMain.handle('user:name', () => userName())
  ipcMain.handle('briefings:list', () => listBriefings())
  ipcMain.handle('briefings:save', (_e, id: string, at: number) => saveBriefing(id, at))
  ipcMain.handle('briefings:latest', (_e, path: string) => latestBriefing(path))
  ipcMain.handle('briefings:hasInstructions', (_e, path: string) => hasSummaryInstructions(path))
  ipcMain.handle('briefings:addInstructions', (_e, path: string) => addSummaryInstructions(path))
  ipcMain.handle('folders:common', () => {
    const folder = (name: 'home' | 'desktop' | 'documents', fallback: string) => { try { return app.getPath(name) } catch { return fallback } }
    const home = folder('home', homedir())
    return { home, desktop: folder('desktop', join(home, 'Desktop')), documents: folder('documents', join(home, 'Documents')) }
  })

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
    if (isQuitting() || process.env.MC_SMOKE) return
    updateStore((s) => {
      s.savedAgents = agents
    })
  })
  ipcMain.handle('agents:loadSaved', () => loadStore().savedAgents)
  ipcMain.handle('workspaces:list', () => loadStore().workspaces)
  ipcMain.handle('workspaces:save', (_e, ws: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
    const now = Date.now()
    return updateStore((s) => {
      const old = ws.id ? s.workspaces.find((w) => w.id === ws.id) : undefined
      const saved: Workspace = { ...ws, id: old?.id ?? randomUUID(), createdAt: old?.createdAt ?? now, updatedAt: now }
      s.workspaces = [saved, ...s.workspaces.filter((w) => w.id !== saved.id)]
    }).workspaces
  })
  ipcMain.handle('workspaces:delete', (_e, id: string) =>
    updateStore((s) => {
      s.workspaces = s.workspaces.filter((w) => w.id !== id)
    }).workspaces
  )
  ipcMain.handle('sessions:exists', (_e, id: string) => sessionExists(id))
  ipcMain.handle('sessions:recent', (_e, limit: number) => recentSessions(limit))

  ipcMain.handle('git:infoMany', (_e, paths: string[]) => gitInfoMany(paths))
  ipcMain.handle('git:createWorktree', (_e, projectPath: string) => createWorktree(projectPath))
  ipcMain.handle('git:changes', (_e, path: string, base?: string) => getChanges(path, base))
  ipcMain.handle('git:commitAll', (_e, path: string, message: string) => { assertTeamWorktreeIdle(path); return commitAll(path, message) })
  ipcMain.handle('git:mergeWorktree', (_e, wt: WorktreeInfo) => { assertTeamWorktreeIdle(wt.path); return mergeWorktree(wt) })
  ipcMain.handle('git:removeWorktree', async (_e, wt: WorktreeInfo) => {
    assertTeamWorktreeIdle(wt.path)
    // Deleting work is permanent, so the confirmation lives here rather than in the UI.
    const { response } = await dialog.showMessageBox(getMainWindow()!, {
      type: 'warning',
      buttons: ['Delete worktree', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Discard worktree',
      message: `Delete the worktree and branch "${wt.branch}"?`,
      detail: `${wt.path}\n\nAgents running in it are stopped. Any changes in it that were not merged are lost for good.`
    })
    if (response !== 0) return false
    assertTeamWorktreeIdle(wt.path)
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
  // Chat titles you set in Mission Control, and names Claude gave chats here, live in the store, not the index.
  const ownTitles = <T extends { sessionId: string; title: string }>(rows: T[]): T[] => {
    const { chatTitles, chatAiNames } = loadStore()
    return rows.map((r) => {
      const t = chatTitles[r.sessionId] || chatAiNames[r.sessionId]
      return t ? { ...r, title: t } : r
    })
  }
  ipcMain.handle('index:search', async (_e, query: string, opts?: object) =>
    ownTitles((await queryIndex('search', query, opts ?? {})) as SearchHit[])
  )
  ipcMain.handle('index:dashboard', () => queryIndex('dashboardActivity'))
  ipcMain.handle('index:vibeStats', async (): Promise<VibeStats> => {
    const [claude, time, codex] = await Promise.all([queryIndex<ClaudeTokenStats>('claudeTokenStats'), queryIndex<VibeTime>('vibeTimeStats'), codexUsage(0)])
    // Codex's input already includes its cached input, and output its reasoning: input + output is every token.
    return { claude, time, codex: { ...codex.totals, total: codex.totals.input + codex.totals.output, byModel: codex.byModel }, at: Date.now() }
  })
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
  ipcMain.handle('tasks:output', (_e, id: string) => getTaskOutput(id))
  ipcMain.handle('tasks:create', (_e, t: NewTask) => createTask(t))
  ipcMain.handle('tasks:team:plan', (_e, id: string, mode?: Task['mode']) => planTaskTeam(id, mode))
  ipcMain.handle('tasks:agent:finish', (_e, id: string) => finishTaskAgent(id))
  ipcMain.handle('tasks:team:start', (_e, id: string) => startTaskTeam(id))
  ipcMain.handle('tasks:team:stop', (_e, id: string) => stopTaskTeam(id))
  ipcMain.handle('tasks:update', (_e, id: string, patch: Partial<Task>) => updateTask(id, patch))
  ipcMain.handle('tasks:delete', (_e, id: string) => deleteTask(id))
  ipcMain.handle('tasks:start', (_e, id: string) => startTask(id))
  ipcMain.handle('tasks:stop', (_e, id: string) => stopTask(id))
  ipcMain.handle('tasks:setRun', (_e, id: string, patch: Partial<TaskRun>, column?: TaskColumn) => setTaskRun(id, patch, column))
  ipcMain.handle('ratelimit:get', () => getRateLimit())
  ipcMain.handle('plan:rate', (_e, force?: boolean) => planRate(!!force))
  ipcMain.handle('digest:get', (_e, which: 'yesterday' | 'today') => buildDigest(which))
  ipcMain.handle('ratelimit:refresh', async () => {
    if (process.env.MC_SMOKE && process.env.MC_SMOKE_WORKSPACE && process.env.MC_SMOKE_PLAN_FIXTURE === 'reject') throw new Error('Fixture IPC rejection')
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
    setQuitting()
    installUpdate()
  })
  ipcMain.on('update:now', () =>
    updateNow(() => {
      setQuitting()
    })
  )
  ipcMain.on('status:summary', (_e, s: { agents: number; attention: number }) => {
    summary = s
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
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}
