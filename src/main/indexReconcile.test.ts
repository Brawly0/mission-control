import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { reconcileMissingFiles } from './indexReconcile'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE files(path TEXT, session_id TEXT);
    INSERT INTO files VALUES ('main', 'a'), ('subagent', 'a'), ('other', 'b');
    CREATE TABLE plan_readings(util REAL); INSERT INTO plan_readings VALUES (0.5);`)
  for (const table of ['sessions', 'msgs', 'fts', 'folders', 'briefings', 'skill_uses']) {
    db.exec(`CREATE TABLE ${table}(session_id TEXT); INSERT INTO ${table} VALUES ('a'), ('b')`)
  }
  return db
}

describe('missing transcript reconciliation', () => {
  it('invalidates a deleted subagent’s whole session so surviving files get reread, preserving other sessions and plan history', () => {
    const db = fixture()
    try {
      const affected = reconcileMissingFiles(db, file => { if (file === 'subagent') throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })
      expect([...affected]).toEqual(['a'])
      for (const table of ['files', 'sessions', 'msgs', 'fts', 'folders', 'briefings', 'skill_uses']) {
        expect(db.prepare(`SELECT session_id FROM ${table}`).all()).toEqual([{ session_id: 'b' }])
      }
      expect(db.prepare('SELECT * FROM plan_readings').all()).toEqual([{ util: 0.5 }])
      expect(reconcileMissingFiles(db, () => undefined).size).toBe(0)
    } finally { db.close() }
  })

  it('does not discard usage when files are temporarily inaccessible', () => {
    const db = fixture()
    try {
      expect(reconcileMissingFiles(db, () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }).size).toBe(0)
      expect(db.prepare('SELECT COUNT(*) n FROM msgs').get()).toEqual({ n: 2 })
    } finally { db.close() }
  })
})
