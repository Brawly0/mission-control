import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/** Best-effort bounded cleanup of process trees owned by this application. */
export function terminateProcessTreesSync(ids: readonly number[]): void {
  const pids = [...new Set(ids)].filter(pid => Number.isSafeInteger(pid) && pid > 0)
  if (!pids.length) return
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH' } }
  if (process.platform === 'win32') {
    const file = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
    const stop = (targets: number[], timeout: number) => {
      const result = spawnSync(file, ['/T', '/F', ...targets.flatMap(pid => ['/PID', String(pid)])], { windowsHide: true, stdio: 'ignore', timeout })
      if (result.error || result.status !== 0) console.warn('Process-tree cleanup failed:', result.error?.message || `taskkill exit ${result.status}`)
    }
    stop(pids, 3000)
    const remaining = pids.filter(alive)
    // A partially successful batch may return nonzero. Retry only surviving owned roots.
    if (remaining.length) stop(remaining, 1000)
  }
  for (const pid of pids.filter(alive)) {
    try { process.kill(pid, 'SIGKILL') }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') console.warn(`Could not stop owned process ${pid}:`, (e as Error).message) }
  }
}
