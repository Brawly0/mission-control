import { describe, expect, it } from 'vitest'
import { applyMyPcSetup, MY_PC_ABOUT, MY_PC_LOG, MY_PC_PROFILE, MY_PC_SETUP_VERSION, myPcClaudeMd, pcProfileMarkdown } from './myPcTemplate'
import { myPcArgs, readmeInfo } from '../shared/projectLook'

const HOME = String.raw`C:\Users\me`
const MY_PC = String.raw`C:\Users\me\My PC`

describe('My PC advisor', () => {
  it('puts the prompt before --add-dir, which takes several values and would swallow it', () => {
    expect(myPcArgs('Why is my PC slow?', ['C:\\', 'D:\\'])).toEqual(['Why is my PC slow?', '--add-dir', 'C:\\', 'D:\\'])
    expect(myPcArgs('  ', ['C:\\'])).toEqual(['--add-dir', 'C:\\'])
    expect(myPcArgs(undefined, [])).toEqual([])
  })

  it('writes an advisor CLAUDE.md that reads its files, uses connectors and asks before changing anything', () => {
    const md = myPcClaudeMd(HOME, '10.0.26200')
    expect(readmeInfo(md, 'My PC').title).toBe('My PC')
    for (const s of ['personal PC','wait for my yes', MY_PC_LOG, MY_PC_PROFILE, MY_PC_ABOUT, 'MCP connectors', String.raw`C:\Users\me\.claude`, String.raw`C:\Windows`]) {
      expect(md).toContain(s)
    }
  })

  it('folds C:\\ into My PC once: chats, notes and tags move, C:\\ leaves the list, My PC is pinned', () => {
    const s = {
      manualProjects: ['C:\\'],
      pinned: ['C:\\', 'D:\\work'],
      projectMeta: { 'c:': { tags: ['pc'], notes: 'drive notes', sortOrder: 4 } } as Record<string, any>,
      chatProjects: { a: 'C:\\', b: 'D:\\work' },
      mergedProjects: {},
      myPcVersion: 0
    }
    expect(applyMyPcSetup(s, MY_PC)).toBe(true)
    expect(s.mergedProjects).toEqual({ 'c:': MY_PC })
    expect(s.manualProjects).toEqual([MY_PC])
    expect(s.pinned).toEqual([MY_PC, 'D:\\work'])
    expect(s.chatProjects).toEqual({ a: MY_PC, b: 'D:\\work' })
    expect(s.projectMeta['c:']).toBeUndefined()
    expect(s.projectMeta['c:\\users\\me\\my pc']).toMatchObject({ icon: 'Cpu', tags: ['pc'] })
    expect(s.projectMeta['c:\\users\\me\\my pc'].notes).toContain('drive notes')
    expect(s.myPcVersion).toBe(MY_PC_SETUP_VERSION)
    // Later runs leave the user's own choices alone (unpinned stays unpinned).
    s.pinned = []
    expect(applyMyPcSetup(s, MY_PC)).toBe(false)
    expect(s.pinned).toEqual([])
  })

  it('writes a readable profile from a survey, tolerating missing and single-object fields', () => {
    const md = pcProfileMarkdown(
      {
        computer: { Manufacturer: 'Acme', Model: 'Laptop 5' },
        os: { Caption: 'Microsoft Windows 11 Home', Version: '10.0.26200', RamGB: 15.7 },
        cpu: { Name: ' Ryzen 7 ', NumberOfCores: 8, NumberOfLogicalProcessors: 16 } as any,
        drives: [{ Name: 'C', UsedGB: 300, FreeGB: 175 }],
        apps: [{ DisplayName: 'VLC', DisplayVersion: '3.0' }, { DisplayName: 'Git' }, { DisplayName: 'VLC' }]
      },
      { at: new Date('2026-11-15T10:00:00Z'), home: HOME, projects: [{ name: 'WBP', path: 'C:\\x\\WBP', description: 'Trading journal.' }], connectors: [{ name: 'playwright', kind: 'stdio', enabled: true }] }
    )
    expect(md).toContain('- Computer: Acme Laptop 5')
    expect(md).toContain('- CPU: Ryzen 7 (8 cores, 16 threads)')
    expect(md).toContain('| C: | 300 GB | 175 GB |')
    expect(md).toContain('## Installed apps (2)')
    expect(md.indexOf('- Git')).toBeLessThan(md.indexOf('- VLC 3.0'))
    expect(md).toContain('- **WBP**: `C:\\x\\WBP`. Trading journal.')
    expect(md).toContain('- playwright (stdio)')
    expect(pcProfileMarkdown({}, { at: new Date(), home: HOME, projects: [], connectors: [] })).toContain('(none configured)')
  })
})
