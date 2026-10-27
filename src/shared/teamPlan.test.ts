import { describe, expect, it } from 'vitest'
import type { TeamAssignment } from './types'
import { assignmentsOverlap, parseTeamPlan, teamPlannerPrompt } from './teamPlan'

const assignment = (patch: Partial<TeamAssignment> = {}): TeamAssignment => ({
  id: 'backend', title: 'Backend', prompt: 'Implement the backend and verify it.', files: ['src/main/'], dependsOn: [], ...patch
})
const plan = (agents: unknown[] = [assignment()], patch: Record<string, unknown> = {}) => ({ summary: 'One focused assignment.', size: 'small', agents, ...patch })
const parse = (value: unknown) => parseTeamPlan(JSON.stringify(value))

describe('parseTeamPlan', () => {
  it('accepts a complete JSON plan and fenced JSON, normalizing path separators', () => {
    const input = plan([assignment({ files: ['src\\main\\ipc.ts', 'SRC/main/IPC.ts', 'src/renderer/'] })])
    const parsed = parse(input)
    expect(parsed.agents[0].files).toEqual(['src/main/ipc.ts', 'src/renderer/'])
    expect(parseTeamPlan('```json\n' + JSON.stringify(input) + '\n```')).toEqual(parsed)
  })

  it('accepts dependencies on earlier assignments', () => {
    expect(parse(plan([assignment(), assignment({ id: 'frontend', dependsOn: ['backend'], files: ['src/renderer/'] })])).agents[1].dependsOn).toEqual(['backend'])
  })

  it.each(['', 'null', '[]', 'invalid', 'Here is your plan: {"agents":[]}', '```json\n{}\n```\nRun these commands next', '{} {}'])('rejects incomplete or wrapped output: %s', reply => {
    expect(() => parseTeamPlan(reply)).toThrow()
  })

  it('rejects oversized replies and invalid plan metadata', () => {
    expect(() => parseTeamPlan(' '.repeat(100_001))).toThrow()
    for (const patch of [{ summary: '' }, { summary: 'x'.repeat(2001) }, { size: 'huge' }, { commands: ['rm -rf .'] }]) {
      expect(() => parse(plan(undefined, patch))).toThrow()
    }
  })

  it('requires one to six scoped assignments', () => {
    expect(() => parse(plan([]))).toThrow()
    expect(() => parse(plan(Array.from({ length: 7 }, (_, i) => assignment({ id: `agent-${i}` }))))).toThrow()
    for (const files of [[], [''], Array.from({ length: 21 }, (_, i) => `src/${i}.ts`)]) {
      expect(() => parse(plan([assignment({ files })]))).toThrow()
    }
  })

  it.each(['.', './', '/', '\\', '..', '../outside', 'src/../../outside', 'src\\..\\outside', 'C:\\outside', 'C:outside', '\\\\server\\share', '/tmp/outside', 'src/*', 'src/**', 'src/?.ts', 'src/[a].ts', 'src/{a,b}.ts', 'src/./file.ts', 'src//file.ts', 'src/dir./file.ts', 'src/file.ts:stream', 'src/\u0000file'])('rejects unsafe or unscoped ownership: %s', path => {
    expect(() => parse(plan([assignment({ files: [path] })]))).toThrow()
  })

  it('rejects duplicate ids, unknown dependencies, self-dependencies and cycles', () => {
    const cases = [
      [assignment(), assignment()],
      [assignment({ dependsOn: ['missing'] })],
      [assignment({ dependsOn: ['backend'] })],
      [assignment({ dependsOn: ['frontend'] }), assignment({ id: 'frontend', dependsOn: ['backend'] })]
    ]
    cases.forEach(agents => expect(() => parse(plan(agents))).toThrow())
  })

  it('rejects malformed assignments and length violations', () => {
    for (const patch of [{ id: '../bad' }, { id: 'A' }, { id: 'x'.repeat(41) }, { title: '' }, { title: 'x'.repeat(121) }, { prompt: '' }, { prompt: 'x'.repeat(12_001) }, { dependsOn: 'backend' }, { files: 'src/main/' }, { run: 'unexpected command' }]) {
      expect(() => parse(plan([{ ...assignment(), ...patch }]))).toThrow()
    }
  })
})

describe('assignmentsOverlap', () => {
  it('detects identical paths and directories case-insensitively', () => {
    expect(assignmentsOverlap(assignment({ files: ['SRC/main/IPC.ts'] }), assignment({ files: ['src\\main\\ipc.ts'] }))).toBe(true)
    expect(assignmentsOverlap(assignment({ files: ['src/main/'] }), assignment({ files: ['src/main/ipc.ts'] }))).toBe(true)
    expect(assignmentsOverlap(assignment({ files: ['src/main/ipc.ts'] }), assignment({ files: ['src/main'] }))).toBe(true)
    expect(assignmentsOverlap(assignment({ files: ['src/'] }), assignment({ files: ['src/main/'] }))).toBe(true)
  })

  it('keeps siblings and common prefixes independent', () => {
    expect(assignmentsOverlap(assignment({ files: ['src/main/'] }), assignment({ files: ['src/renderer/'] }))).toBe(false)
    expect(assignmentsOverlap(assignment({ files: ['src/main/'] }), assignment({ files: ['src/main-extra/ipc.ts'] }))).toBe(false)
    expect(assignmentsOverlap(assignment({ files: ['src/main/ipc.ts'] }), assignment({ files: ['src/main/tasks.ts'] }))).toBe(false)
  })
})

describe('teamPlannerPrompt', () => {
  it('preserves the complete task while requesting a small scoped read-only plan', () => {
    const prompt = teamPlannerPrompt({ title: 'Wire task teams', prompt: 'Implement frontend, backend, and tests.\nKeep existing tasks working.' })
    expect(prompt).toContain('Inspect the repository and its instructions read-only')
    expect(prompt).toContain('1 to 6 agents')
    expect(prompt).toContain('dependencies refer only to earlier ids')
    expect(prompt).toContain('"dependsOn":[]')
    expect(prompt).toContain(JSON.stringify({ title: 'Wire task teams', prompt: 'Implement frontend, backend, and tests.\nKeep existing tasks working.' }))
  })
})
