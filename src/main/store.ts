import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, ProjectMeta, SavedAgent, Task, UiState } from '../shared/types'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/**
 * The app's own data. Claude Code's files are never written to; everything
 * the user adds (manual projects, pins, open agents, later tags and notes) lives here.
 */
export interface StoreData {
  manualProjects: string[]
  pinned: string[]
  /** Agents that were open when the app last closed, offered for restore on next start. */
  savedAgents: SavedAgent[]
  ui: UiState
  window?: WindowBounds
  /** Group, tags, status and notes per project, keyed by lower-cased path. */
  projectMeta: Record<string, ProjectMeta>
  tasks: Task[]
  settings: AppSettings
}

const defaults: StoreData = {
  manualProjects: [],
  pinned: [],
  savedAgents: [],
  ui: {},
  projectMeta: {},
  tasks: [],
  settings: { hotkey: 'Ctrl+Alt+M', closeToTray: true }
}

function storePath(): string {
  return join(app.getPath('userData'), 'store.json')
}

export function loadStore(): StoreData {
  const fresh = structuredClone(defaults)
  try {
    const file = storePath()
    if (!existsSync(file)) return fresh
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return { ...fresh, ...data, settings: { ...fresh.settings, ...data.settings } }
  } catch {
    return fresh
  }
}

export function saveStore(data: StoreData): void {
  const file = storePath()
  mkdirSync(dirname(file), { recursive: true })
  // Write then rename, so a crash mid-write can't leave a half-written store.
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function updateStore(fn: (data: StoreData) => void): StoreData {
  const data = loadStore()
  fn(data)
  saveStore(data)
  return data
}
