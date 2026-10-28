import { DEFAULT_GUIDED_SETUP, validateSetupPatch } from '../shared/readiness'
import type { GuidedSetupState } from '../shared/readiness'
import { app } from 'electron'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AiRecap, AppSettings, Note, Workspace, ProjectMeta, SavedAgent, Task, TaskTemplate, UiState } from '../shared/types'

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
  /** Additive app-only onboarding state; never modifies provider configuration. */
  guidedSetup: GuidedSetupState
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
  /** Names Claude gave chats (Name chats, Summarize), by session id; your own titles win. */
  chatAiNames: Record<string, string>
  /** Summaries Claude wrote for chats, by session id. */
  chatRecaps: Record<string, AiRecap>
  /** Chats started with Eco mode on, by session id (first such launch), for the Eco check. */
  ecoSessions: Record<string, number>
  /** Day ("2026-10-24") the daily digest was last shown. */
  digestShown: string
  /** Saved sets of agents (Agents → Workspaces). */
  workspaces: Workspace[]
}

const defaults: StoreData = {
  guidedSetup: DEFAULT_GUIDED_SETUP,
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
  ecoSessions: {},
  chatAiNames: {},
  chatRecaps: {},
  digestShown: '',
  workspaces: [],
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
    digestTime: '09:00',
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
  for (const file of [storePath(), `${storePath()}.bak`]) {
    try {
      if (!existsSync(file)) continue
      const data = readStore(file)
      return { ...fresh, ...data, guidedSetup: normalizeGuidedSetup(data.guidedSetup), settings: { ...fresh.settings, ...data.settings, eco: { ...fresh.settings.eco, ...data.settings?.eco } } }
    } catch { /* Try the last valid backup before using defaults. */ }
  }
  return fresh
}

function readStore(file: string): Partial<StoreData> {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid settings file')
  for (const key of ['manualProjects', 'pinned', 'savedAgents', 'tasks', 'templates', 'notes', 'workspaces', 'limitAlerted']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Invalid settings: ${key}`)
  }
  for (const key of ['settings', 'ui', 'projectMeta']) {
    if (data[key] !== undefined && (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))) throw new Error(`Invalid settings: ${key}`)
  }
  return data
}

export function saveStore(data: StoreData): void {
  const file = storePath()
  mkdirSync(dirname(file), { recursive: true })
  // Write then rename, so a crash mid-write can't leave a half-written store.
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  if (existsSync(file)) {
    let valid = true
    try { readStore(file) } catch { valid = false }
    // Preserve damaged input for manual recovery; never replace a valid backup with it.
    copyFileSync(file, valid ? `${file}.bak` : `${file}.corrupt-${Date.now()}`)
  }
  renameSync(tmp, file)
}

export function updateStore(fn: (data: StoreData) => void): StoreData {
  const data = loadStore()
  fn(data)
  saveStore(data)
  return data
}

function normalizeGuidedSetup(value: unknown): GuidedSetupState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(DEFAULT_GUIDED_SETUP)
  const { providers, status, step, updatedAt } = value as GuidedSetupState
  try {
    const patch = { ...(providers !== undefined ? { providers } : {}), ...(status !== undefined ? { status } : {}), ...(step !== undefined ? { step } : {}) }
    validateSetupPatch(patch)
    return { ...structuredClone(DEFAULT_GUIDED_SETUP), ...patch, updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0 }
  } catch { return structuredClone(DEFAULT_GUIDED_SETUP) }
}
export function getGuidedSetup(): GuidedSetupState { return loadStore().guidedSetup }
export function updateGuidedSetup(patch: Partial<Pick<GuidedSetupState, 'providers' | 'status' | 'step'>>): GuidedSetupState {
  validateSetupPatch(patch)
  return updateStore(s => { s.guidedSetup = { ...s.guidedSetup, ...patch, updatedAt: Date.now() } }).guidedSetup
}
