import { contextBridge, ipcRenderer } from 'electron'
import type { MissionControlApi } from '../shared/types'

const api: MissionControlApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  listSessions: (key) => ipcRenderer.invoke('sessions:list', key),
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
  }
}

contextBridge.exposeInMainWorld('mc', api)
