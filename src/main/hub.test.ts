import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ name: '', installed: false, exec: vi.fn(), connections: vi.fn() }))
vi.mock('./readiness', () => ({ readiness: { connections: fixture.connections }, legacyStatus: (status: unknown) => status }))
vi.mock('node:child_process', () => ({ execFile: fixture.exec }))
vi.mock('./store', () => ({ loadStore: () => ({ settings: { userName: fixture.name } }), updateStore: vi.fn() }))
vi.mock('./claudeData', () => ({ listProjects: vi.fn(), normalizePath: (p: string) => p }))
vi.mock('./git', () => ({ initGit: vi.fn() }))
vi.mock('./pty', () => ({ agentEnv: () => ({}), whichSync: () => fixture.installed ? 'fixture.exe' : null }))
beforeEach(() => { vi.resetModules(); fixture.name = ''; fixture.installed = false; fixture.exec.mockReset(); vi.stubEnv('MC_SMOKE_CLEAN', '') })
afterEach(() => vi.unstubAllEnvs())
it('preserves an explicitly configured name', async () => {
  fixture.name = '  Developer  '
  expect(await (await import('./hub')).userName()).toBe('Developer')
  expect(fixture.exec).not.toHaveBeenCalled()
})
it('uses the Windows full-name first word and caches the lookup', async () => {
  fixture.exec.mockImplementation((_file, _args, _opts, cb) => cb(null, 'Fixture Person\r\n'))
  const { userName } = await import('./hub')
  expect(await userName()).toBe('Fixture')
  expect(await userName()).toBe('Fixture')
  expect(fixture.exec).toHaveBeenCalledOnce()
  expect(fixture.exec.mock.calls[0][1].join(' ')).toContain('Win32_UserAccount')
})
it.each(['', 'failure'])('omits the name when Windows lookup yields %s', async value => {
  fixture.exec.mockImplementation((_file, _args, _opts, cb) => cb(value ? new Error('failed') : null, ''))
  expect(await (await import('./hub')).userName()).toBe('')
})
it('clean screenshots exercise unset name without looking up real identity', async () => {
  vi.stubEnv('MC_SMOKE_CLEAN', '1')
  expect(await (await import('./hub')).userName()).toBe('')
  expect(fixture.exec).not.toHaveBeenCalled()
})
it('routes legacy connection queries through the shared diagnostic service', async () => {
  fixture.connections.mockResolvedValue({ installed: true, loggedIn: false })
  const { claudeStatus } = await import('./hub')
  expect(await claudeStatus(true)).toMatchObject({ installed: true, loggedIn: false })
  expect(fixture.connections.mock.calls[0][1]).toMatchObject({ providers: ['claude'], force: true })
  fixture.connections.mockRejectedValue(new Error('Connection readiness could not be verified'))
  await expect(claudeStatus(true)).rejects.toThrow('could not be verified')
})
vi.mock('../renderer/src/components/ui', () => ({}))
const connectionHelpers = () => vi.importActual<{
  parseConnectionCache(value: string): Partial<Record<'claude' | 'codex', unknown>>
  validConnectionReading(raw: unknown): unknown
}>('../renderer/src/components/AgentConnections')
it('validates cached connections independently and strips sensitive fields', async () => {
  const { parseConnectionCache } = await connectionHelpers()
  const reading = { at: Date.now() - 600_000, status: { installed: true, loggedIn: true, email: 'private', token: 'secret' } }
  const parsed = parseConnectionCache(JSON.stringify({ claude: reading, codex: { at: 'bad', status: {} } }))
  expect(parsed.claude).toEqual({ at: reading.at, status: { installed: true, loggedIn: true } })
  expect(parsed.codex).toBeUndefined()
})
it('rejects malformed, missing, future, expired and failed cache readings', async () => {
  const { parseConnectionCache, validConnectionReading } = await connectionHelpers()
  for (const raw of ['{broken', 'null', '[]', '{}']) expect(parseConnectionCache(raw).claude).toBeUndefined()
  for (const at of [0, Date.now() + 120_000, Date.now() - 31 * 86400_000, NaN]) {
    expect(validConnectionReading({ at, status: { installed: true, loggedIn: true } })).toBeUndefined()
  }
  expect(validConnectionReading({ at: Date.now(), status: { installed: 'true', loggedIn: true } })).toBeUndefined()
  expect(validConnectionReading({ at: Date.now(), status: { installed: true, loggedIn: false, error: 'unknown' } })).toBeUndefined()
})
