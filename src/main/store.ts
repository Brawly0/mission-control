import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, Note, ProjectMeta, SavedAgent, Task, TaskTemplate, UiState } from '../shared/types'

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
  templates: TaskTemplate[]
  settings: AppSettings
  /** Month ("2026-10") in which each project's 80% budget warning was last shown. */
  budgetWarned: Record<string, string>
  /** Chat titles you set in Mission Control, by session id. */
  chatTitles: Record<string, string>
  /** Project folder you filed a chat under (Move to project), by session id. */
  chatProjects: Record<string, string>
  /** Chats already reported as expensive today: { day: "2026-10-24", ids }. */
  costAlerted: { day: string; ids: string[] }
  /** Plan-limit alerts already shown, as "window@resetsAt:kind", so each fires once per window. */
  limitAlerted: string[]
  /** Your own notes (Notebook). */
  notes: Note[]
  /** Compactions from this time on are saved as briefings automatically (set the first time the app runs it). */
  briefingsFrom: number
  /** Saved briefing files by "sessionId:time". */
  briefingsSaved: Record<string, string>
}

const defaults: StoreData = {
  manualProjects: [],
  pinned: [],
  savedAgents: [],
  ui: {},
  projectMeta: {},
  tasks: [],
  templates: [],
  budgetWarned: {},
  chatTitles: {},
  chatProjects: {},
  costAlerted: { day: '', ids: [] },
  limitAlerted: [],
  notes: [],
  briefingsFrom: 0,
  briefingsSaved: {},
  settings: {
    defaultTaskBudgetUsd: 0,
    defaultTaskModel: '',
    chatCostAlertUsd: 20,
    planAlertPercent: 80,
    eco: { enabled: false, model: 'sonnet', effort: '', autocompactTokens: 150_000, coach: true, skill: true },
    contextWarnTokens: 200_000,
    keybindings: {},
    theme: 'dark',
    uiZoom: 1,
    userName: '',
    autoBriefings: true,
    hotkey: 'Ctrl+Alt+M',
    closeToTray: true,
    queueEnabled: false,
    queueParallel: 1,
    queuePauseAtPercent: 95,
    autoUpdate: true
  }
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
