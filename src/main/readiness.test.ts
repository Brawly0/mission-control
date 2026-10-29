import { afterEach, describe, expect, it, vi } from 'vitest'
import { join, resolve } from 'node:path'
import { ReadinessService, legacyStatus, readinessDependencies } from './readiness'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import type { ReadinessDependencies, ProbeResult } from './readiness'

const root = resolve('readiness-fixture')
const ok = (stdout = '', code = 0, stderr = ''): ProbeResult => ({ stdout, code, stderr })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function fixture(files: Record<string, string> = {}) {
  const deps: ReadinessDependencies = {
    now: () => 1234,
    discover: vi.fn(async tool => `/tools/${tool}`),
    run: vi.fn(async (_file, args) => args[0] === '--version' ? ok('tool 1.2.3') : args[0] === 'auth' ? ok('{"loggedIn":true,"email":"SECRET@example.com","token":"SECRET"}') : args[0] === 'login' ? ok('', 0, 'Logged in using ChatGPT') : args.includes('--is-inside-work-tree') ? ok('true\n') : ok('a'.repeat(40))),
    folder: vi.fn(async () => {}),
    read: vi.fn(async path => files[path] ?? null)
  }
  const service = new ReadinessService(deps)
  const connections = (requestId = 'one', providers: ('claude' | 'codex')[] = ['claude', 'codex'], owner = 1) => service.connections(owner, { requestId, providers })
  const project = () => service.project(1, { requestId: 'project', projectPath: root, requireHistory: true })
  return { deps, service, connections, project }
}
afterEach(() => vi.useRealTimers())

describe('read-only provider probes', () => {
  it('bounds real subprocess output and cancels a local child without leaking its output', async () => {
    const deps = readinessDependencies()
    await expect(deps.run(process.execPath, ['-e', 'process.stdout.write("SECRET".repeat(20000))'], undefined, new AbortController().signal)).rejects.toThrow('probe_failed')
    const controller = new AbortController()
    const pending = deps.run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], undefined, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
  })
  it('verifies installed tools and authentication without exposing raw output or accounts', async () => {
    const { connections, deps } = fixture()
    const result = await connections()
    expect(result.outcome).toBe('ready')
    expect(result.checks).toHaveLength(5)
    expect(result.requestId).toBe('one')
    expect(result.completedAt).toBe(1234)
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(vi.mocked(deps.run).mock.calls.map(c => c[1])).toEqual([['--version'], ['auth', 'status'], ['--version'], ['login', 'status'], ['--version']])
  })
  it('reports missing tools without attempting a process', async () => {
    const { connections, deps } = fixture(); vi.mocked(deps.discover).mockResolvedValue(null)
    const result = await connections()
    expect(result.checks.every(c => c.reason === 'tool_missing')).toBe(true)
    expect(legacyStatus(result, 'claude')).toMatchObject({ installed: false, loggedIn: false, authentication: { outcome: 'unavailable' } })
    expect(deps.run).not.toHaveBeenCalled()
  })
  it.each([
    ['unsupported', ok('unexpected account SECRET'), 'auth_unknown'],
    ['false on failed probe', ok('{"loggedIn":false}', 2), 'auth_unknown'],
    ['true on failed probe', ok('{"loggedIn":true}', 1), 'auth_unknown'],
    ['network even with signed-out data', ok('{"loggedIn":false}', 1, 'ENETUNREACH SECRET'), 'offline'],
    ['network error', ok('', 1, 'network error SECRET'), 'offline'],
    ['only explicit signout', ok('{"loggedIn":false}', 0), 'signed_out']
  ])('handles %s honestly', async (_name, auth, reason) => {
    const { connections, deps } = fixture()
    vi.mocked(deps.run).mockImplementation(async (_file, args) => args[0] === 'auth' ? auth : ok('1.2.3'))
    const result = await connections('one', ['claude'])
    expect(result.checks.find(c => c.id === 'claude.authentication')?.reason).toBe(reason)
    if (reason === 'signed_out') expect(legacyStatus(result, 'claude').loggedIn).toBe(false)
    else expect(() => legacyStatus(result, 'claude')).toThrow('could not be verified')
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
  it.each(['timeout', 'arbitrary SECRET diagnostic failure'])('sanitizes thrown %s', async message => {
    const { connections, deps } = fixture(); vi.mocked(deps.run).mockRejectedValue(new Error(message))
    const result = await connections()
    expect(result.checks.every(c => c.outcome === 'unavailable')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result.checks[0].reason).toBe(message === 'timeout' ? 'timeout' : 'probe_failed')
  })
  it('does not accept a loose Codex logged-in substring', async () => {
    const { connections, deps } = fixture(); vi.mocked(deps.run).mockResolvedValue(ok('not sure whether logged in'))
    expect((await connections('one', ['codex'])).checks.find(c => c.id === 'codex.authentication')?.outcome).toBe('unavailable')
  })
})

describe('lifetime and concurrency', () => {
  it('removes cancelled queued waiters while active probes remain occupied', async () => {
    const { service, connections, deps } = fixture()
    const gate = deferred<string | null>()
    vi.mocked(deps.discover).mockImplementation(() => gate.promise)
    const first = connections('first', ['claude'], 1)
    const second = connections('second', ['claude'], 2)
    await Promise.resolve(); await Promise.resolve()
    for (let i = 0; i < 40; i++) {
      const queued = connections(`queued-${i}`, ['claude'], 3)
      service.cancel(3, `queued-${i}`)
      expect((await queued).outcome).toBe('cancelled')
    }
    expect((service as unknown as { waiters: unknown[] }).waiters).toHaveLength(0)
    service.cancel(1); service.cancel(2); gate.resolve(null)
    await Promise.all([first, second])
  })
  it('scopes cancellation to the requesting renderer and ignores a late completion', async () => {
    const { connections, deps, service } = fixture(); const slow = deferred<string | null>()
    vi.mocked(deps.discover).mockReturnValue(slow.promise)
    const pending = connections(); await Promise.resolve(); await Promise.resolve()
    expect(service.cancel(2, 'one')).toBe(false)
    expect(service.cancel(1, 'one')).toBe(true)
    const result = await pending
    expect(result.outcome).toBe('cancelled')
    slow.resolve('/tool'); await Promise.resolve(); await Promise.resolve()
    expect(result.outcome).toBe('cancelled')
    expect(deps.run).not.toHaveBeenCalled()
  })
  it('supersedes an in-flight request even on forced refresh', async () => {
    const { service, deps } = fixture(); const slow = deferred<string | null>()
    vi.mocked(deps.discover).mockImplementationOnce(() => slow.promise)
    const old = service.connections(1, { requestId: 'old', providers: ['claude'] })
    await Promise.resolve(); await Promise.resolve()
    const fresh = service.connections(1, { requestId: 'fresh', providers: ['claude'], force: true })
    expect((await old).outcome).toBe('stale')
    expect((await fresh).outcome).toBe('ready')
    slow.resolve('/old-tool')
  })
  it('bounds active diagnostics and retains capacity for a cancelled but unsettled filesystem operation', async () => {
    const { connections, deps, service } = fixture(); const slow = deferred<string | null>()
    vi.mocked(deps.discover).mockReturnValue(slow.promise)
    const first = connections('first', ['claude'], 1)
    const second = connections('second', ['claude'], 2)
    const third = connections('third', ['claude'], 3)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(deps.discover).toHaveBeenCalledTimes(2)
    service.cancel(1, 'first'); expect((await first).outcome).toBe('cancelled')
    await Promise.resolve(); expect(deps.discover).toHaveBeenCalledTimes(2)
    service.shutdown(); expect((await second).outcome).toBe('cancelled'); expect((await third).outcome).toBe('cancelled')
    slow.resolve(null)
  })
  it('times out interrupted operations and stops accepting checks after shutdown', async () => {
    vi.useFakeTimers()
    const { connections, deps, service } = fixture()
    const slow = deferred<string | null>(); vi.mocked(deps.discover).mockReturnValue(slow.promise)
    const pending = connections(); await vi.advanceTimersByTimeAsync(25001)
    expect((await pending).checks[0].reason).toBe('timeout')
    service.shutdown()
    expect((await connections('after')).checks[0].reason).toBe('busy')
    slow.resolve(null)
  })
  it('bounds the total number of queued and active requests', async () => {
    const { connections, deps, service } = fixture()
    const slow = deferred<string | null>(); vi.mocked(deps.discover).mockReturnValue(slow.promise)
    const pending = Array.from({ length: 20 }, (_, i) => connections(`job${i}`, ['claude'], i))
    expect((await Promise.all(pending.slice(16))).every(result => result.checks[0].reason === 'busy')).toBe(true)
    service.shutdown()
    expect((await Promise.all(pending.slice(0, 16))).every(result => result.outcome === 'cancelled')).toBe(true)
    slow.resolve(null)
  })
  it('validates IPC-facing arguments', async () => {
    const { service } = fixture()
    expect(() => service.connections(1, { requestId: 'id', providers: ['unknown'] as never })).toThrow()
    await expect(service.connections(1, { requestId: '../invalid', providers: ['claude'] })).rejects.toThrow()
    expect(() => service.project(1, { requestId: 'id', projectPath: 'relative' })).toThrow()
    expect(() => service.project(1, { requestId: 'id', projectPath: root, requireHistory: 'yes' as never })).toThrow()
  })
})

describe('project diagnosis', () => {
  it('inspects real local fixture files without changing their content or creating files', async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), 'mc-readiness-'))
    try {
      await fs.writeFile(join(folder, 'package.json'), '{"scripts":{"start":"DO NOT RUN SECRET", "test":"DO NOT RUN"}}')
      await fs.writeFile(join(folder, 'package-lock.json'), '{}')
      const names = await fs.readdir(folder)
      const before = await fs.readFile(join(folder, 'package.json'), 'utf8')
      const { deps } = fixture()
      const service = new ReadinessService(readinessDependencies({ run: deps.run, discover: deps.discover }))
      const result = await service.project(1, { requestId: 'real-fixture', projectPath: folder, requireHistory: true })
      expect(result.outcome).toBe('ready')
      expect(result.suggestions.map(c => c.command)).toEqual(['npm run start', 'npm run test'])
      expect(await fs.readdir(folder)).toEqual(names)
      expect(await fs.readFile(join(folder, 'package.json'), 'utf8')).toBe(before)
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(vi.mocked(deps.run).mock.calls.every(([_file, args]) => args[0] === 'rev-parse')).toBe(true)
      await fs.writeFile(join(folder, 'package.json'), 'x'.repeat(128 * 1024 + 1))
      expect((await service.project(1, { requestId: 'oversized', projectPath: folder })).checks.find(c => c.id === 'project.manifest')?.reason).toBe('manifest_oversized')
    } finally { await fs.rm(folder, { recursive: true, force: true }) }
  })
  it('suggests known script names with provenance without returning script bodies or executing them', async () => {
    const { project, deps } = fixture({ [join(root, 'package.json')]: JSON.stringify({ scripts: { dev: 'SECRET; execute malicious code', test: 'SECRET', custom: 'SECRET' } }), [join(root, 'pnpm-lock.yaml')]: 'lockfile' })
    const result = await project()
    expect(result.outcome).toBe('ready')
    expect(result.suggestions).toEqual([
      { kind: 'run', command: 'pnpm run dev', trusted: false, provenance: { manifest: 'package.json', script: 'dev', manager: 'pnpm' } },
      { kind: 'test', command: 'pnpm run test', trusted: false, provenance: { manifest: 'package.json', script: 'test', manager: 'pnpm' } }
    ])
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(vi.mocked(deps.run).mock.calls.every(([file, args]) => file === '/tools/git' && args[0] === 'rev-parse')).toBe(true)
    expect(Object.keys(deps).sort()).toEqual(['discover', 'folder', 'now', 'read', 'run']) // no mutation seam
  })
  it.each([
    ['bad json', '{broken', 'manifest_invalid'],
    ['array', '[]', 'manifest_invalid'],
    ['null', 'null', 'manifest_invalid'],
    ['oversized', 'x'.repeat(128 * 1024 + 1), 'manifest_oversized'],
    ['invalid scripts', '{"scripts":[]}', 'manifest_invalid'],
    ['unknown package manager', '{"packageManager":"secret@1"}', 'manifest_ambiguous']
  ])('handles %s manifests', async (_name, raw, reason) => {
    const { project } = fixture({ [join(root, 'package.json')]: raw })
    const result = await project()
    expect(result.checks.find(c => c.id === 'project.manifest')?.reason).toBe(reason)
    expect(result.suggestions).toEqual([])
  })
  it('does not assume missing, unsupported, or conflicting manifests are successful', async () => {
    const absent = await fixture().project()
    expect(absent.checks.find(c => c.id === 'project.manifest')?.reason).toBe('manifest_missing')
    const unsupported = await fixture({ [join(root, 'Cargo.toml')]: '[package]' }).project()
    expect(unsupported.checks.find(c => c.id === 'project.manifest')?.reason).toBe('manifest_unsupported')
    const ambiguous = await fixture({ [join(root, 'package.json')]: '{}', [join(root, 'pnpm-lock.yaml')]: '', [join(root, 'yarn.lock')]: '' }).project()
    expect(ambiguous.checks.find(c => c.id === 'project.manifest')?.reason).toBe('manifest_ambiguous')
  })
  it('requires actual history for isolation and distinguishes Git failures from a non-repository', async () => {
    const { project, deps } = fixture()
    vi.mocked(deps.run).mockImplementation(async (_file, args) => args.includes('--is-inside-work-tree') ? ok('true') : ok('', 1))
    expect((await project()).checks.find(c => c.id === 'project.history')?.reason).toBe('history_missing')
    vi.mocked(deps.run).mockResolvedValue(ok('', 128, 'not a git repository'))
    expect((await project()).checks.find(c => c.id === 'project.git')?.reason).toBe('not_repository')
    vi.mocked(deps.run).mockResolvedValue(ok('', 128, 'access denied SECRET'))
    expect((await project()).checks.find(c => c.id === 'project.git')?.outcome).toBe('unavailable')
  })
  it('explains missing tools and folders without hiding read errors', async () => {
    const { project, deps } = fixture(); vi.mocked(deps.discover).mockResolvedValue(null)
    expect((await project()).checks.find(c => c.id === 'project.git')?.reason).toBe('tool_missing')
    vi.mocked(deps.folder).mockRejectedValue(Object.assign(new Error('SECRET'), { code: 'ENOENT' }))
    const result = await project()
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].reason).toBe('folder_missing')
    vi.mocked(deps.folder).mockRejectedValue(new Error('SECRET'))
    expect((await project()).checks[0].reason).toBe('folder_inaccessible')
  })
  it('distinguishes inaccessible manifests from invalid JSON', async () => {
    const { project, deps } = fixture()
    vi.mocked(deps.read).mockRejectedValue(Object.assign(new Error('SECRET'), { code: 'EACCES' }))
    const result = await project()
    expect(result.checks.find(c => c.id === 'project.manifest')).toMatchObject({ reason: 'manifest_inaccessible', outcome: 'unavailable' })
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
})
