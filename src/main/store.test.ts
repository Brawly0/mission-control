import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => profile.path } }))
import { loadStore, saveStore, updateStore } from './store'

afterEach(() => { if (profile.path) rmSync(profile.path, { recursive: true, force: true }) })
const setup = () => { profile.path = mkdtempSync(join(tmpdir(), 'mc-store-test-')); return join(profile.path, 'store.json') }

describe('settings recovery', () => {
  it('starts with independent defaults and merges older nested settings', () => {
    const file = setup()
    const first = loadStore(); first.tasks.push({} as never)
    expect(loadStore().tasks).toEqual([])
    writeFileSync(file, JSON.stringify({ settings: { eco: { model: 'haiku' } }, pinned: ['C:\\project'] }))
    expect(loadStore().settings.eco).toMatchObject({ model: 'haiku', coach: true })
    expect(loadStore().pinned).toEqual(['C:\\project'])
  })
  it('keeps the previous valid file and recovers it after a damaged write', () => {
    const file = setup()
    updateStore(s => { s.notes = [{ id: 'saved', title: 'Keep me', body: 'important', createdAt: 1, updatedAt: 1 }] })
    updateStore(s => { s.settings.userName = 'Later' })
    writeFileSync(file, '{broken')
    expect(loadStore().notes[0].body).toBe('important')
    updateStore(s => { s.settings.theme = 'light' })
    expect(JSON.parse(readFileSync(file, 'utf8')).notes[0].body).toBe('important')
    const damaged = readdirSync(profile.path).find(f => f.startsWith('store.json.corrupt-'))!
    expect(readFileSync(join(profile.path, damaged), 'utf8')).toBe('{broken')
    expect(JSON.parse(readFileSync(file + '.bak', 'utf8')).notes[0].body).toBe('important')
  })
  it('preserves malformed first input even when no backup exists', () => {
    const file = setup(); writeFileSync(file, 'null')
    saveStore(loadStore())
    expect(readdirSync(profile.path).some(f => f.startsWith('store.json.corrupt-'))).toBe(true)
    expect(loadStore().tasks).toEqual([])
  })
  it('rejects malformed collection shapes and uses the last valid backup', () => {
    const file = setup(); updateStore(s => { s.pinned = ['saved'] }); saveStore(loadStore())
    writeFileSync(file, JSON.stringify({ tasks: {}, pinned: ['lost'] }))
    expect(loadStore().pinned).toEqual(['saved'])
  })
})

describe('guided setup compatibility', () => {
  it('adds setup state without changing projects, commands, task records or user settings', async () => {
    const { getGuidedSetup, updateGuidedSetup } = await import('./store')
    const file = setup()
    const old = { manualProjects: ['C:\\existing'], pinned: ['C:\\existing'], tasks: [{ id: 'task', prompt: 'keep' }], projectMeta: { existing: { commands: [{ id: 'run', command: 'npm start' }], checkCommand: 'npm test' } }, settings: { theme: 'light', userName: 'Keep', eco: { model: 'haiku' } }, futureField: { keep: true } }
    writeFileSync(file, JSON.stringify(old))
    expect(getGuidedSetup()).toMatchObject({ status: 'not-started', providers: ['claude'] })
    for (const status of ['active', 'skipped', 'dismissed', 'active'] as const) updateGuidedSetup({ status, providers: ['claude', 'codex'], step: 'project' })
    const result = JSON.parse(readFileSync(file, 'utf8'))
    for (const key of ['manualProjects', 'pinned', 'tasks', 'projectMeta', 'futureField'] as const) expect(result[key]).toEqual(old[key])
    expect(result.settings).toMatchObject(old.settings)
    expect(getGuidedSetup()).toMatchObject({ status: 'active', providers: ['claude', 'codex'], step: 'project' })
  })
  it('repairs invalid setup independently of an otherwise valid profile and rejects invalid writes', async () => {
    const { getGuidedSetup, updateGuidedSetup } = await import('./store')
    const file = setup()
    writeFileSync(file, JSON.stringify({ pinned: ['keep'], guidedSetup: { providers: ['unknown'], status: 'invalid' } }))
    expect(getGuidedSetup().status).toBe('not-started')
    expect(loadStore().pinned).toEqual(['keep'])
    expect(() => updateGuidedSetup({ providers: [] })).toThrow('Invalid setup')
    expect(loadStore().pinned).toEqual(['keep'])
  })
})
