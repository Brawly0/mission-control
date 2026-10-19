import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The app's own data. Claude Code's files are never written to; everything
 * the user adds (manual projects, pins, later tags and notes) lives here.
 */
export interface StoreData {
  manualProjects: string[]
  pinned: string[]
}

const defaults: StoreData = { manualProjects: [], pinned: [] }

function storePath(): string {
  return join(app.getPath('userData'), 'store.json')
}

export function loadStore(): StoreData {
  try {
    const file = storePath()
    if (!existsSync(file)) return { ...defaults }
    return { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { ...defaults }
  }
}

export function saveStore(data: StoreData): void {
  const file = storePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

export function updateStore(fn: (data: StoreData) => void): StoreData {
  const data = loadStore()
  fn(data)
  saveStore(data)
  return data
}
