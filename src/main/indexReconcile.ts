import { statSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

/** Drop derived rows for sessions with vanished files; the next scan reindexes their surviving files. */
export function reconcileMissingFiles(db: DatabaseSync, stat: (path: string) => unknown = statSync): Set<string> {
  const affected = new Set<string>()
  for (const row of db.prepare('SELECT path, session_id FROM files').all() as { path: string; session_id: string }[]) {
    try { stat(row.path) } catch (error) {
      // An inaccessible drive or permission error is not proof that the source was deleted.
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) affected.add(row.session_id)
    }
  }
  if (!affected.size) return affected
  db.exec('BEGIN')
  try {
    // Messages are keyed by session, not source file. Rebuilding the whole affected session
    // also handles deleted subagents and shared message IDs without subtracting the wrong usage.
    for (const table of ['files', 'sessions', 'msgs', 'fts', 'folders', 'briefings', 'skill_uses']) {
      const drop = db.prepare(`DELETE FROM ${table} WHERE session_id = ?`)
      for (const id of affected) drop.run(id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return affected
}
