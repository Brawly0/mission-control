import { contextBridge, ipcRenderer } from 'electron'
import type { HookEvent, IndexStatus, MissionControlApi, QueueStatus, RateLimitInfo, Task, TaskTemplate, UpdateState } from '../shared/types'

/** Subscribes to a main-process event; returns the unsubscribe function. */
function on<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: MissionControlApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  listSessions: (key) => ipcRenderer.invoke('sessions:list', key),
  renameSession: (id, title) => ipcRenderer.invoke('sessions:rename', id, title),
  getSession: (key, id) => ipcRenderer.invoke('sessions:get', key, id),
  addProject: () => ipcRenderer.invoke('projects:add'),
  removeProject: (path) => ipcRenderer.invoke('projects:remove', path),
  togglePin: (path) => ipcRenderer.invoke('projects:togglePin', path),
  listDocs: (path) => ipcRenderer.invoke('docs:list', path),
  readDoc: (file) => ipcRenderer.invoke('docs:read', file),
  writeDoc: (file, content) => ipcRenderer.invoke('docs:write', file, content),
  openInExplorer: (path) => ipcRenderer.invoke('open:explorer', path),
  openInVSCode: (path) => ipcRenderer.invoke('open:vscode', path),
  openExternalTerminal: (cwd, args) => ipcRenderer.invoke('open:terminal', cwd, args),

  ptySpawn: (spec) => ipcRenderer.invoke('pty:spawn', spec),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => {
    const handler = (_e: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on('pty:data', handler)
    return () => ipcRenderer.removeListener('pty:data', handler)
  },
  onPtyExit: (cb) => {
    const handler = (_e: unknown, id: string, code: number) => cb(id, code)
    ipcRenderer.on('pty:exit', handler)
    return () => ipcRenderer.removeListener('pty:exit', handler)
  },

  onHookEvent: (cb) => {
    const handler = (_e: unknown, event: HookEvent) => cb(event)
    ipcRenderer.on('hook:event', handler)
    return () => ipcRenderer.removeListener('hook:event', handler)
  },
  saveAgents: (agents) => ipcRenderer.send('agents:save', agents),
  loadSavedAgents: () => ipcRenderer.invoke('agents:loadSaved'),
  sessionExists: (id) => ipcRenderer.invoke('sessions:exists', id),
  focusWindow: () => ipcRenderer.send('window:focus'),

  recentSessions: (limit) => ipcRenderer.invoke('sessions:recent', limit),
  gitInfoMany: (paths) => ipcRenderer.invoke('git:infoMany', paths),
  createWorktree: (path) => ipcRenderer.invoke('git:createWorktree', path),
  getChanges: (path, base) => ipcRenderer.invoke('git:changes', path, base),
  commitAll: (path, message) => ipcRenderer.invoke('git:commitAll', path, message),
  mergeWorktree: (wt) => ipcRenderer.invoke('git:mergeWorktree', wt),
  removeWorktree: (wt) => ipcRenderer.invoke('git:removeWorktree', wt),
  setProjectMeta: (path, patch) => ipcRenderer.invoke('projects:setMeta', path, patch),
  search: (query, opts) => ipcRenderer.invoke('index:search', query, opts),
  usageReport: (since) => ipcRenderer.invoke('index:usage', since),
  sessionUsage: (key) => ipcRenderer.invoke('index:sessionUsage', key),
  indexStatus: () => ipcRenderer.invoke('index:status'),
  reindex: () => ipcRenderer.send('index:run'),
  onIndexStatus: (cb) => {
    const handler = (_e: unknown, s: IndexStatus) => cb(s)
    ipcRenderer.on('index:status', handler)
    return () => ipcRenderer.removeListener('index:status', handler)
  },
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  createTask: (t) => ipcRenderer.invoke('tasks:create', t),
  updateTask: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  startTask: (id) => ipcRenderer.invoke('tasks:start', id),
  stopTask: (id) => ipcRenderer.invoke('tasks:stop', id),
  setTaskRun: (id, patch, column) => ipcRenderer.invoke('tasks:setRun', id, patch, column),
  onTasksChanged: (cb) => {
    const handler = (_e: unknown, tasks: Task[]) => cb(tasks)
    ipcRenderer.on('tasks:changed', handler)
    return () => ipcRenderer.removeListener('tasks:changed', handler)
  },
  onRateLimit: (cb) => {
    const handler = (_e: unknown, info: RateLimitInfo) => cb(info)
    ipcRenderer.on('ratelimit', handler)
    return () => ipcRenderer.removeListener('ratelimit', handler)
  },
  getRateLimit: () => ipcRenderer.invoke('ratelimit:get'),
  followUpTask: (id, prompt) => ipcRenderer.invoke('tasks:followUp', id, prompt),
  rerunChecks: (id) => ipcRenderer.invoke('tasks:rerunChecks', id),
  previewGitInit: (folder) => ipcRenderer.invoke('git:previewInit', folder),
  initGit: (folder) => ipcRenderer.invoke('git:init', folder),
  budgets: () => ipcRenderer.invoke('budgets:all'),
  onBudgetsChanged: (cb) => on<void>('budgets:changed', cb),
  queueStatus: () => ipcRenderer.invoke('queue:status'),
  onQueueStatus: (cb) => on<QueueStatus>('queue:status', cb),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  saveTemplate: (t, id) => ipcRenderer.invoke('templates:save', t, id),
  deleteTemplate: (id) => ipcRenderer.invoke('templates:delete', id),
  runTemplate: (id, then, projectPath) => ipcRenderer.invoke('templates:run', id, then, projectPath),
  onTemplatesChanged: (cb) => on<TaskTemplate[]>('templates:changed', cb),
  onLaunchTask: (cb) => on<string>('task:launch', cb),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdateStatus: (cb) => on<UpdateState>('update:status', cb),
  reportStatus: (summary) => ipcRenderer.send('status:summary', summary),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onNavigate: (cb) => {
    const handler = (_e: unknown, target: { view: string; newTask?: boolean }) => cb(target)
    ipcRenderer.on('navigate', handler)
    return () => ipcRenderer.removeListener('navigate', handler)
  },
  getUiState: () => ipcRenderer.invoke('ui:get'),
  setUiState: (patch) => ipcRenderer.send('ui:set', patch),

  smoke: Boolean(process.env.MC_SMOKE)
}

contextBridge.exposeInMainWorld('mc', api)
