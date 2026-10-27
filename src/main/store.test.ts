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
