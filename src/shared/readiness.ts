/** Readiness is observational: no install, login, Git init, script execution or project writes.
 * Support is deliberately root-only: package.json (npm scripts). Other recognized manifests
 * are reported as unsupported; no workspace traversal, TOML evaluation or code imports.
 * Results are snapshots; use requestId to reject late UI updates and recheck after changes.
 * IPC promises return terminal snapshots; render `checking` locally while awaiting them.
 * `ready` verifies only the named check, not dependencies or the ability to run a task.
 * `missing` is a confirmed absent requirement; `failed` is invalid manifest data;
 * `unavailable` means verification was inconclusive and must never be shown as success.
 */
export const READINESS_MANIFESTS = ['package.json'] as const
export const RECOGNIZED_UNSUPPORTED_MANIFESTS = ['pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Makefile'] as const
export type ReadinessOutcome = 'checking' | 'ready' | 'missing' | 'failed' | 'unavailable' | 'cancelled' | 'stale'
export type ReadinessReason = 'checking' | 'verified' | 'tool_missing' | 'signed_out' | 'auth_unknown' | 'probe_failed' | 'timeout' | 'offline' | 'cancelled' | 'superseded' | 'busy' | 'folder_missing' | 'folder_inaccessible' | 'not_repository' | 'history_missing' | 'manifest_missing' | 'manifest_unsupported' | 'manifest_invalid' | 'manifest_inaccessible' | 'manifest_oversized' | 'manifest_ambiguous' | 'scripts_missing'
export interface ReadinessCheck {
  id: string
  outcome: ReadinessOutcome
  reason: ReadinessReason
  /** Fixed, sanitized explanation; never raw process output or account data. */
  explanation: string
  action: 'recheck' | 'setup' | 'open-project' | 'review-commands' | 'none'
  checkedAt: number
  /** Numeric CLI version only, never raw version output. */
  version?: string
}
export interface ReadinessRequest { requestId: string }
/** All requests are fresh; force is accepted for callers that expose a Refresh action. */
export interface ConnectionReadinessRequest extends ReadinessRequest { providers: ('claude' | 'codex')[]; force?: boolean }
export interface ProjectReadinessRequest extends ReadinessRequest { projectPath: string; requireHistory?: boolean }
export interface CommandSuggestion {
  kind: 'run' | 'test'
  command: string
  /** Untrusted manifest-derived suggestion. Review before saving through setProjectMeta. */
  trusted: false
  provenance: { manifest: 'package.json'; script: string; manager: 'npm' | 'pnpm' | 'yarn' | 'bun' }
}
export interface ReadinessResult {
  requestId: string
  startedAt: number
  completedAt: number
  /** Superseded and cancelled results must never resolve problems in the UI. */
  outcome: ReadinessOutcome
  checks: ReadinessCheck[]
  suggestions: CommandSuggestion[]
}
export interface GuidedSetupState {
  providers: ('claude' | 'codex')[]
  status: 'not-started' | 'active' | 'skipped' | 'dismissed' | 'complete'
  /** Last visible step; UI still derives advancement from verified app state. */
  step: 'connect' | 'project' | 'task' | 'progress' | 'review'
  updatedAt: number
}
export const DEFAULT_GUIDED_SETUP: GuidedSetupState = { providers: ['claude'], status: 'not-started', step: 'connect', updatedAt: 0 }
export function validRequestId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id) }
export function validateSetupPatch(value: unknown): asserts value is Partial<Pick<GuidedSetupState, 'providers' | 'status' | 'step'>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid setup state')
  const p = value as Record<string, unknown>
  if (Object.keys(p).some(k => !['providers', 'status', 'step'].includes(k)) ||
    (p.providers !== undefined && (!Array.isArray(p.providers) || p.providers.length < 1 || p.providers.length > 2 || new Set(p.providers).size !== p.providers.length || p.providers.some(x => x !== 'claude' && x !== 'codex'))) ||
    (p.status !== undefined && !['not-started', 'active', 'skipped', 'dismissed', 'complete'].includes(String(p.status))) ||
    (p.step !== undefined && !['connect', 'project', 'task', 'progress', 'review'].includes(String(p.step)))) throw new Error('Invalid setup state')
}
/** A problem only disappears on an explicit, fresh verification of the same check. */
export function readinessProblems(result: ReadinessResult): ReadinessCheck[] {
  return result.checks.filter(c => c.outcome !== 'ready' && c.outcome !== 'checking')
}
/** Reconcile within one connection/project scope. Missing checks remain unresolved;
 * only a fresh ready check with the same id removes a previous problem.
 * Callers must additionally compare requestId to their latest requested identity.
 */
export function reconcileReadinessProblems(previous: ReadinessCheck[], result: ReadinessResult): ReadinessCheck[] {
  if (['checking', 'cancelled', 'stale'].includes(result.outcome)) return previous
  const problems = new Map(previous.map(c => [c.id, c]))
  // A completed diagnostic replaces a previous job-level interruption/busy problem.
  // Its individual unmet requirements remain represented by their own stable IDs.
  if (result.checks.length && !result.checks.some(c => c.id === 'diagnostic')) problems.delete('diagnostic')
  for (const current of result.checks) {
    if (['checking', 'cancelled', 'stale'].includes(current.outcome)) continue
    const old = problems.get(current.id)
    if (old && old.checkedAt > current.checkedAt) continue
    if (current.outcome === 'ready') problems.delete(current.id)
    else problems.set(current.id, current)
  }
  return [...problems.values()]
}
