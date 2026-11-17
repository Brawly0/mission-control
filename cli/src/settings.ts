import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AURAS, type Aura } from './tree'

/** mc's own preferences, kept between sessions. Never under ~/.claude. */
export interface Settings {
  aura: Aura
  /** tree: the animated work tree while agents run · lines: one status row per agent */
  view: 'tree' | 'lines'
}

const DEFAULTS: Settings = { aura: 'mood', view: 'tree' }

export function settingsPath(): string {
  const base = process.env.MC_SETTINGS_DIR ?? (process.env.APPDATA ? join(process.env.APPDATA, 'mc') : join(homedir(), '.config', 'mc'))
  return join(base, 'settings.json')
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    return {
      aura: AURAS.includes(raw.aura) ? raw.aura : DEFAULTS.aura,
      view: raw.view === 'lines' ? 'lines' : 'tree'
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch { /* not being able to save a colour is not worth an error */ }
}

/** The settings for this process: read once, changed by /aura and /view. */
export const settings: Settings = loadSettings()
