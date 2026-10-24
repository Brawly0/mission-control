import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import workerPath from './indexWorker?modulePath'
import type { IndexStatus } from '../shared/types'
import { claudeProjectsDir } from './claudeData'

/**
 * Owns the indexer worker thread. Indexing and SQLite queries run there so the main process
 * (and with it every terminal) never stalls on large session files.
 */
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
let lastStatus: IndexStatus = { indexing: false, done: 0, total: 0, sessions: 0, messages: 0, lastRun: 0 }
let timer: NodeJS.Timeout | null = null

export function startIndexer(onStatus: (s: IndexStatus) => void): void {
  worker = new Worker(workerPath, {
    // Self-tests keep their own index, so they never write to the file a running installed copy uses.
    workerData: { dbPath: join(app.getPath('userData'), process.env.MC_SMOKE ? 'index-smoke.db' : 'index.db'), projectsDir: claudeProjectsDir }
  })
  worker.on('message', (msg: any) => {
    if (msg.type === 'status') {
      lastStatus = msg.status
      onStatus(msg.status)
    } else if (msg.type === 'result') {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (!p) return
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    }
  })
  worker.on('error', (err) => {
    lastStatus = { ...lastStatus, indexing: false, error: err.message }
    onStatus(lastStatus)
  })
  // Pick up new and appended chats every minute.
  timer = setInterval(() => worker?.postMessage({ type: 'run' }), 60_000)
}

export function reindex(): void {
  worker?.postMessage({ type: 'run' })
}

export function queryIndex<T>(op: string, ...args: unknown[]): Promise<T> {
  if (!worker) return Promise.reject(new Error('Indexer not running'))
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ type: 'query', id, op, args })
  })
}

export function indexStatus(): IndexStatus {
  return lastStatus
}

export async function stopIndexer(): Promise<void> {
  if (timer) clearInterval(timer)
  await worker?.terminate()
  worker = null
}
