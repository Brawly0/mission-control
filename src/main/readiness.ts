import { execFile } from 'node:child_process'
import { promises as fs, constants } from 'node:fs'
import { delimiter, isAbsolute, join, normalize } from 'node:path'
import type { ClaudeStatus } from '../shared/types'
import { RECOGNIZED_UNSUPPORTED_MANIFESTS, validRequestId } from '../shared/readiness'
import type { ConnectionReadinessRequest, ProjectReadinessRequest, ReadinessCheck, ReadinessOutcome, ReadinessReason, ReadinessResult, CommandSuggestion } from '../shared/readiness'

export interface ProbeResult { code: number; stdout: string; stderr: string }
export interface ReadinessDependencies {
  discover(tool: string, signal: AbortSignal): Promise<string | null>
  run(file: string, args: string[], cwd: string | undefined, signal: AbortSignal): Promise<ProbeResult>
  folder(path: string): Promise<void>
  read(path: string): Promise<string | null>
  now(): number
}
const MAX_FILE = 128 * 1024
/** Async PATH discovery; never invokes whichSync or a shell to search. */
async function discover(tool: string, signal: AbortSignal): Promise<string | null> {
  const dirs = (process.env.PATH ?? '').split(delimiter).slice(0, 128)
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of dirs) for (const ext of extensions) {
    signal.throwIfAborted()
    if (!dir || !isAbsolute(dir.replace(/^"|"$/g, ''))) continue // Never discover executables in the selected project.
    const file = join(dir.replace(/^"|"$/g, ''), tool + ext)
    if (process.platform === 'win32' && /[%!"\r\n]/.test(file)) continue
    try { if ((await fs.stat(file)).isFile()) { await fs.access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return file } } catch { /* next PATH entry */ }
  }
  return null
}
function run(file: string, args: string[], cwd: string | undefined, signal: AbortSignal): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    // Only fixed diagnostic arguments reach this seam. No scripts, package managers or model prompts.
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' }
    delete env.FORCE_COLOR
    delete env.CLAUDECODE
    delete env.CLAUDE_CODE_ENTRYPOINT
    const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
    // cmd's own quoting is needed for npm shims in paths containing spaces. /d
    // disables AutoRun. All arguments are fixed by this module, never manifest data.
    const executable = shim ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') : file
    const commandArgs = shim ? ['/d', '/s', '/c', `""${file}" ${args.map(arg => `"${arg}"`).join(' ')}"`] : args
    let expired = false
    const child = execFile(executable, commandArgs, { cwd, env, windowsHide: true, windowsVerbatimArguments: shim, maxBuffer: 32 * 1024 }, (error, stdout, stderr) => {
      clearTimeout(timer)
      if (signal.aborted) { reject(new Error('cancelled')); return }
      if (expired) { reject(new Error('timeout')); return }
      if (error && typeof error.code !== 'number') { void kill(); reject(new Error('probe_failed')); return }
      resolve({ code: error ? Number(error.code) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
    // Kill the Windows tree before its parent: aborting execFile directly can lose
    // the shim's descendant PIDs. Keep the job slot reserved during bounded cleanup.
    let killing: Promise<void> | undefined
    const kill = (): Promise<void> => killing ??= new Promise(done => {
      if (process.platform === 'win32' && child.pid) execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 2000, maxBuffer: 1024 }, () => { child.kill('SIGKILL'); done() })
      else { child.kill('SIGKILL'); done() }
    })
    // Resolve the timeout even if a shim's descendants inherited its output pipes.
    const timer = setTimeout(() => { expired = true; void kill().then(() => reject(new Error('timeout'))) }, 6000)
    const abort = () => { clearTimeout(timer); void kill().then(() => reject(new Error('cancelled'))) }
    signal.addEventListener('abort', abort, { once: true })
    child.once('close', () => signal.removeEventListener('abort', abort))
  })
}
const defaults: ReadinessDependencies = {
  discover, run, now: Date.now,
  async folder(path) { if (!(await fs.stat(path)).isDirectory()) throw Object.assign(new Error(), { code: 'ENOENT' }); await fs.access(path, constants.R_OK) },
  async read(path) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      handle = await fs.open(path, 'r')
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error('manifest_invalid')
      if (stat.size > MAX_FILE) throw new Error('manifest_oversized')
      const bytes = Buffer.alloc(MAX_FILE + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > MAX_FILE) throw new Error('manifest_oversized')
      return bytes.subarray(0, bytesRead).toString('utf8')
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    finally { await handle?.close() }
  }
}
/** Tests can replace process execution while exercising real bounded filesystem reads. */
export function readinessDependencies(overrides: Partial<ReadinessDependencies> = {}): ReadinessDependencies { return { ...defaults, ...overrides } }
const messages: Record<ReadinessReason, string> = {
  manifest_inaccessible: 'A manifest or package-manager file could not be read. Check its permissions and availability, then recheck or save commands manually.',
  checking: 'Checking readiness.', verified: 'Verified by a read-only check.', tool_missing: 'The CLI was not found on PATH. Install it, then recheck.', signed_out: 'The CLI reports no login. Open its setup and sign in, then recheck.', auth_unknown: 'The CLI did not return a supported login status. Update it or verify login in a terminal, then recheck.', probe_failed: 'The check could not finish. Verify the tool works in a terminal, then recheck.', timeout: 'The check timed out. Check the tool or folder is available, then retry.', offline: 'The CLI reported a network problem. Restore connectivity and recheck.', cancelled: 'The check was cancelled. Recheck when ready.', superseded: 'A newer check replaced this result. Wait for the latest check.', busy: 'Readiness checks are busy. Retry shortly.', folder_missing: 'The selected folder is missing. Choose an existing folder.', folder_inaccessible: 'The folder could not be read. Check access permissions or choose another folder.', not_repository: 'This folder is not a Git working tree. Open a repository or use the existing Git setup action.', history_missing: 'Git has no usable HEAD commit. Worktree isolation needs an initial commit; review Git setup first.', manifest_missing: 'No recognized root package manifest was found. Add run and check commands manually in project settings.', manifest_unsupported: 'This manifest is recognized but automatic command inference is not supported. Review project documentation and save commands manually.', manifest_invalid: 'The package manifest cannot be safely parsed. Fix its JSON or save commands manually.', manifest_oversized: 'The manifest exceeds the 128 KiB diagnostic limit. Save commands manually.', manifest_ambiguous: 'Conflicting package manager files were found. Choose commands manually.', scripts_missing: 'No supported run or test scripts were found. Save commands manually.'
}
function check(id: string, outcome: ReadinessOutcome, reason: ReadinessReason, now: number): ReadinessCheck {
  return { id, outcome, reason, checkedAt: now, explanation: messages[reason], action: outcome === 'ready' ? 'none' : reason === 'tool_missing' || reason === 'signed_out' ? 'setup' : reason.startsWith('manifest') || reason === 'scripts_missing' ? 'review-commands' : reason === 'folder_missing' ? 'open-project' : 'recheck' }
}
function failure(error: unknown): ReadinessReason { return error instanceof Error && ['timeout', 'manifest_oversized', 'manifest_invalid'].includes(error.message) ? error.message as ReadinessReason : 'probe_failed' }
function offline(output: string): boolean { return /\b(ENOTFOUND|ENETUNREACH|ECONNREFUSED|EAI_AGAIN|network error|offline|connection timed out)\b/i.test(output) }

/** Electron-free service, injected in tests. Two active jobs, 16 queued/active jobs total;
 * no retained result cache. Each renderer has one connection and one project slot.
 * A newer request always aborts the previous slot, including forced refreshes.
 */
export class ReadinessService {
  private jobs = new Map<string, { owner: number; slot: string; controller: AbortController; stale: boolean }>()
  private active = 0
  private waiters: (() => void)[] = []
  private stopped = false
  constructor(private deps: ReadinessDependencies = defaults) {}
  cancel(owner: number, requestId?: string): boolean {
    let found = false
    for (const [key, job] of this.jobs) if (job.owner === owner && (requestId === undefined || key === `${owner}:${requestId}`)) { found = true; job.controller.abort() }
    return found
  }
  shutdown(): void { this.stopped = true; for (const job of this.jobs.values()) job.controller.abort() }
  private async execute(owner: number, requestId: string, slot: string, work: (signal: AbortSignal) => Promise<{ checks: ReadinessCheck[]; suggestions?: CommandSuggestion[] }>): Promise<ReadinessResult> {
    if (!validRequestId(requestId)) throw new Error('Invalid readiness request id')
    const key = `${owner}:${requestId}`
    if (this.jobs.has(key)) throw new Error('Readiness request id already active')
    const startedAt = this.deps.now()
    const result = (checks: ReadinessCheck[], suggestions: CommandSuggestion[] = []): ReadinessResult => ({ requestId, startedAt, completedAt: this.deps.now(), outcome: checks.some(c => c.outcome === 'stale') ? 'stale' : checks.some(c => c.outcome === 'cancelled') ? 'cancelled' : checks.every(c => c.outcome === 'ready') ? 'ready' : checks.some(c => c.outcome === 'failed') ? 'failed' : checks.some(c => c.outcome === 'missing') ? 'missing' : 'unavailable', checks, suggestions })
    if (this.stopped || this.jobs.size >= 16) return result([check('diagnostic', 'unavailable', 'busy', startedAt)])
    for (const job of this.jobs.values()) if (job.owner === owner && job.slot === slot) { job.stale = true; job.controller.abort() }
    const job = { owner, slot, controller: new AbortController(), stale: false }
    this.jobs.set(key, job)
    const signal = job.controller.signal
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; job.controller.abort() }, 25_000)
    let acquired = false
    let pending: Promise<{ checks: ReadinessCheck[]; suggestions?: CommandSuggestion[] }> | undefined
    let abortListener: (() => void) | undefined
    try {
      const aborted = new Promise<never>((_, reject) => { abortListener = () => reject(new Error('cancelled')); signal.addEventListener('abort', abortListener, { once: true }) })
      const acquire = async () => {
        while (this.active >= 2) await new Promise<void>(resolve => {
          const wake = () => { signal.removeEventListener('abort', wake); const i = this.waiters.indexOf(wake); if (i >= 0) this.waiters.splice(i, 1); resolve() }
          this.waiters.push(wake); signal.addEventListener('abort', wake, { once: true })
        })
        signal.throwIfAborted(); this.active++; acquired = true
      }
      await Promise.race([acquire(), aborted])
      pending = work(signal)
      const value = await Promise.race([pending, aborted])
      signal.throwIfAborted()
      return result(value.checks, value.suggestions)
    } catch {
      const reason = job.stale ? 'superseded' : timedOut ? 'timeout' : signal.aborted ? 'cancelled' : 'probe_failed'
      return result([check('diagnostic', job.stale ? 'stale' : reason === 'cancelled' ? 'cancelled' : 'unavailable', reason, this.deps.now())])
    } finally {
      clearTimeout(timer); if (abortListener) signal.removeEventListener('abort', abortListener)
      // A cancelled filesystem operation may still be settling in the OS. Keep its
      // capacity reserved until it really finishes rather than admitting unbounded orphans.
      const release = () => {
        this.jobs.delete(key)
        if (acquired) { this.active--; this.waiters.shift()?.() }
      }
      if (pending) void pending.then(release, release)
      else release()
    }
  }
  connections(owner: number, request: ConnectionReadinessRequest): Promise<ReadinessResult> {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !Array.isArray(request.providers) || !request.providers.length || request.providers.length > 2 || new Set(request.providers).size !== request.providers.length || request.providers.some(p => p !== 'claude' && p !== 'codex') || (request.force !== undefined && typeof request.force !== 'boolean')) throw new Error('Invalid connection readiness request')
    return this.execute(owner, request.requestId, 'connections', async signal => {
      const checks: ReadinessCheck[] = []
      for (const tool of [...request.providers, 'git']) {
        signal.throwIfAborted()
        let file: string | null
        try { file = await this.deps.discover(tool, signal) } catch (error) {
          checks.push(check(`${tool}.installation`, 'unavailable', failure(error), this.deps.now()))
          if (tool !== 'git') checks.push(check(`${tool}.authentication`, 'unavailable', failure(error), this.deps.now()))
          continue
        }
        signal.throwIfAborted()
        if (!file) { checks.push(check(`${tool}.installation`, 'missing', 'tool_missing', this.deps.now())); if (tool !== 'git') checks.push(check(`${tool}.authentication`, 'unavailable', 'tool_missing', this.deps.now())); continue }
        try {
          const version = await this.deps.run(file, ['--version'], undefined, signal)
          const number = /\b(\d{1,5}\.\d{1,5}(?:\.\d{1,5})?)\b/.exec(version.stdout)?.[1]
          checks.push({ ...check(`${tool}.installation`, version.code === 0 && number ? 'ready' : 'unavailable', version.code === 0 && number ? 'verified' : 'probe_failed', this.deps.now()), ...(version.code === 0 && number ? { version: number } : {}) })
        } catch (error) { checks.push(check(`${tool}.installation`, 'unavailable', failure(error), this.deps.now())) }
        signal.throwIfAborted()
        if (tool === 'git') continue
        try {
          const auth = await this.deps.run(file, tool === 'claude' ? ['auth', 'status'] : ['login', 'status'], undefined, signal)
          const output = auth.stdout + '\n' + auth.stderr
          let loggedIn: boolean | undefined
          if (tool === 'claude') {
            try { const parsed = JSON.parse(auth.stdout); if (typeof parsed?.loggedIn === 'boolean' && !parsed.error && !parsed.errors) loggedIn = parsed.loggedIn } catch { /* unsupported output */ }
          } else {
            // Deliberately narrow documented CLI messages. Never return their contents.
            if (/^Not logged in\s*$/im.test(output)) loggedIn = false
            else if (/^Logged in using (ChatGPT|an API key)\b/im.test(output)) loggedIn = true
          }
          const reason = offline(output) ? 'offline' : loggedIn === true && auth.code === 0 ? 'verified' : loggedIn === false && (auth.code === 0 || auth.code === 1) ? 'signed_out' : 'auth_unknown'
          checks.push(check(`${tool}.authentication`, reason === 'verified' ? 'ready' : reason === 'signed_out' ? 'missing' : 'unavailable', reason, this.deps.now()))
        } catch (error) { checks.push(check(`${tool}.authentication`, 'unavailable', failure(error), this.deps.now())) }
      }
      return { checks }
    })
  }
  project(owner: number, request: ProjectReadinessRequest): Promise<ReadinessResult> {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.projectPath !== 'string' || request.projectPath.length > 4096 || request.projectPath.includes('\0') || !isAbsolute(request.projectPath) || (request.requireHistory !== undefined && typeof request.requireHistory !== 'boolean')) throw new Error('Invalid project readiness request')
    return this.execute(owner, request.requestId, 'project', async signal => {
      const path = normalize(request.projectPath)
      const checks: ReadinessCheck[] = []
      const add = (id: string, outcome: ReadinessOutcome, reason: ReadinessReason) => checks.push(check(id, outcome, reason, this.deps.now()))
      try { await this.deps.folder(path); add('project.folder', 'ready', 'verified') } catch (error) { const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'; add('project.folder', missing ? 'missing' : 'unavailable', missing ? 'folder_missing' : 'folder_inaccessible'); return { checks } }
      signal.throwIfAborted()
      try {
        const git = await this.deps.discover('git', signal)
        signal.throwIfAborted()
        if (!git) add('project.git', 'unavailable', 'tool_missing')
        else {
          const repo = await this.deps.run(git, ['rev-parse', '--is-inside-work-tree'], path, signal)
          if (repo.code === 0 && repo.stdout.trim() === 'true') {
            add('project.git', 'ready', 'verified')
            if (request.requireHistory) {
              signal.throwIfAborted()
              try {
                const head = await this.deps.run(git, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], path, signal)
                const verified = head.code === 0 && /^[a-f0-9]{40,64}\s*$/i.test(head.stdout)
                add('project.history', verified ? 'ready' : head.code === 1 ? 'missing' : 'unavailable', verified ? 'verified' : head.code === 1 ? 'history_missing' : 'probe_failed')
              } catch (error) { add('project.history', 'unavailable', failure(error)) }
            }
          } else if ((repo.code === 0 && repo.stdout.trim() === 'false') || (repo.code !== 0 && /not a git repository/i.test(repo.stderr))) add('project.git', 'missing', 'not_repository')
          else add('project.git', 'unavailable', 'probe_failed')
        }
      } catch (error) { add('project.git', 'unavailable', failure(error)) }
      signal.throwIfAborted()
      const suggestions: CommandSuggestion[] = []
      try {
        const raw = await this.deps.read(join(path, 'package.json'))
        signal.throwIfAborted()
        if (raw === null) {
          let recognized = false
          for (const name of RECOGNIZED_UNSUPPORTED_MANIFESTS) { signal.throwIfAborted(); if (await this.deps.read(join(path, name)) !== null) { recognized = true; break } }
          add('project.manifest', 'unavailable', recognized ? 'manifest_unsupported' : 'manifest_missing')
        } else {
          if (Buffer.byteLength(raw) > MAX_FILE) throw new Error('manifest_oversized')
          let manifest: Record<string, unknown>
          try { manifest = JSON.parse(raw); if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error() } catch { throw new Error('manifest_invalid') }
          const locks: string[] = []
          for (const [name, manager] of [['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun']]) {
            signal.throwIfAborted()
            // Content is irrelevant; bounded reads also reject special/unreadable files.
            try { if (await this.deps.read(join(path, name)) !== null) locks.push(manager) } catch (error) { if (failure(error) === 'manifest_oversized') locks.push(manager); else throw error }
          }
          const declared = typeof manifest.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@\d[^\s]*$/.exec(manifest.packageManager)?.[1] : undefined
          const managers = new Set([...locks, ...(declared ? [declared] : [])])
          if (managers.size > 1 || (manifest.packageManager !== undefined && !declared)) add('project.manifest', 'unavailable', 'manifest_ambiguous')
          else {
            add('project.manifest', 'ready', 'verified')
            const manager = (declared ?? locks[0] ?? 'npm') as 'npm' | 'pnpm' | 'yarn' | 'bun'
            const scripts = manifest.scripts
            if (scripts !== undefined && (!scripts || typeof scripts !== 'object' || Array.isArray(scripts))) throw new Error('manifest_invalid')
            const values = scripts as Record<string, unknown> | undefined
            for (const [kind, names] of [['run', ['dev', 'start']], ['test', ['test', 'check', 'lint']]] as const) {
              const script = names.find(name => typeof values?.[name] === 'string' && (values[name] as string).trim() && (values[name] as string).length <= 8192 && !/echo\s+["']?Error: no test specified/i.test(values[name] as string))
              if (script) suggestions.push({ kind, command: `${manager} run ${script}`, trusted: false, provenance: { manifest: 'package.json', script, manager } })
            }
            add('project.scripts', suggestions.length ? 'ready' : 'unavailable', suggestions.length ? 'verified' : 'scripts_missing')
          }
        }
      } catch (error) {
        const previous = checks.findIndex(c => c.id === 'project.manifest')
        if (previous >= 0) checks.splice(previous, 1)
        const reason = failure(error) === 'probe_failed' ? 'manifest_inaccessible' : failure(error)
        add('project.manifest', reason === 'manifest_invalid' ? 'failed' : 'unavailable', reason)
      }
      return { checks, suggestions }
    })
  }
}
export const readiness = new ReadinessService()
export function legacyStatus(result: ReadinessResult, tool: 'claude' | 'codex'): ClaudeStatus {
  const installation = result.checks.find(c => c.id === `${tool}.installation`) ?? result.checks[0]
  const authentication = result.checks.find(c => c.id === `${tool}.authentication`) ?? result.checks[0]
  // The legacy boolean contract cannot represent unknown. Reject so existing cards
  // use their check-failed path rather than showing a definitive signed-out status.
  if (!installation || !['ready', 'missing'].includes(installation.outcome) ||
    (installation.outcome === 'ready' && (!authentication || !['ready', 'missing'].includes(authentication.outcome)))) {
    throw new Error('Connection readiness could not be verified. Recheck the connection.')
  }
  return { installed: installation?.outcome === 'ready', loggedIn: authentication?.outcome === 'ready', version: installation?.version, installation, authentication }
}
