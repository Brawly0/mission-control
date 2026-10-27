import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDashboardActivity } from './dashboardData'

let db: DatabaseSync
const at = (day: number, hour = 12, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second).getTime()
const now = at(28, 18)
const session = (id: string, provider = 'claude') => db.prepare('INSERT INTO sessions(session_id, project_key) VALUES (?, ?)').run(id, provider === 'codex' ? 'codex' : 'C--project')
const event = (id: string, ts: string | number | null, role = 'assistant') => db.prepare('INSERT INTO fts(body, session_id, role, ts) VALUES (?, ?, ?, ?)').run('content is irrelevant to activity', id, role, ts)

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE sessions(session_id TEXT PRIMARY KEY, project_key TEXT);
    CREATE VIRTUAL TABLE fts USING fts5(body, session_id UNINDEXED, role UNINDEXED, ts UNINDEXED);
  `)
})
afterEach(() => db.close())

describe('readDashboardActivity', () => {
  it('returns honest zero values for an empty index', () => {
    expect(readDashboardActivity(db, now)).toEqual({ days: [], sessions: 0, activeDays: 0, activeMinutes: 0 })
  })

  it('counts a single event as one active chat and day without inventing duration', () => {
    session('one')
    event('one', String(at(27)))
    expect(readDashboardActivity(db, now)).toEqual({
      days: [{ day: '2026-10-27', tool: 'claude', sessions: 1, events: 1, activeMinutes: 0 }],
      sessions: 1, activeDays: 1, activeMinutes: 0
    })
  })

  it('counts both providers separately per day and each resumed session once in the total', () => {
    session('claude-one')
    session('claude-two')
    session('codex-one', 'codex')
    event('claude-one', at(27))
    event('claude-one', at(27, 12, 5))
    event('claude-two', at(27))
    event('codex-one', at(27))
    event('codex-one', at(27, 12, 10))
    event('claude-one', at(28))
    event('codex-one', at(28))
    expect(readDashboardActivity(db, now)).toEqual({
      days: [
        { day: '2026-10-27', tool: 'claude', sessions: 2, events: 3, activeMinutes: 5 },
        { day: '2026-10-27', tool: 'codex', sessions: 1, events: 2, activeMinutes: 10 },
        { day: '2026-10-28', tool: 'claude', sessions: 1, events: 1, activeMinutes: 0 },
        { day: '2026-10-28', tool: 'codex', sessions: 1, events: 1, activeMinutes: 0 }
      ], sessions: 3, activeDays: 2, activeMinutes: 15
    })
  })

  it('deduplicates equal numeric/string timestamps across roles within a session', () => {
    session('one')
    event('one', at(27), 'user')
    event('one', String(at(27)), 'assistant')
    event('one', at(27, 12, 5), 'assistant')
    event('one', String(at(27, 12, 5)), 'assistant')
    const result = readDashboardActivity(db, now)
    expect(result.days[0]).toMatchObject({ events: 2, sessions: 1, activeMinutes: 5 })
    expect(result.activeMinutes).toBe(5)
  })

  it('never connects one session to another and ignores long idle gaps', () => {
    session('one')
    session('two')
    event('one', at(27))
    event('two', at(27, 12, 5))
    event('one', at(27, 12, 15))
    event('one', at(27, 12, 30, 1))
    event('two', at(27, 13))
    const result = readDashboardActivity(db, now)
    expect(result.activeMinutes).toBe(15)
    expect(result.days[0]).toMatchObject({ sessions: 2, events: 5, activeMinutes: 15 })
  })

  it('ignores invalid, nonpositive, future, unlinked and non-chat timestamps', () => {
    session('one')
    for (const value of ['', 'garbage', 'NaN', '123garbage', null, 0, -1, at(29)]) event('one', value)
    event('missing-session', at(27))
    event('one', at(27), 'system')
    event('one', at(27, 12, 5), 'tool')
    event('one', at(27, 12, 10), 'user')
    expect(readDashboardActivity(db, now)).toEqual({
      days: [{ day: '2026-10-27', tool: 'claude', sessions: 1, events: 1, activeMinutes: 0 }],
      sessions: 1, activeDays: 1, activeMinutes: 0
    })
  })

  it('clamps a short cross-midnight gap to the later day local midnight', () => {
    session('one', 'codex')
    event('one', at(27, 23, 55))
    event('one', at(28, 0, 5))
    expect(readDashboardActivity(db, now)).toEqual({
      days: [
        { day: '2026-10-27', tool: 'codex', sessions: 1, events: 1, activeMinutes: 0 },
        { day: '2026-10-28', tool: 'codex', sessions: 1, events: 1, activeMinutes: 5 }
      ], sessions: 1, activeDays: 2, activeMinutes: 5
    })
  })

  it('preserves sub-minute estimates and includes activity exactly at now', () => {
    session('one')
    event('one', now - 30_000)
    event('one', now)
    event('one', now + 1)
    const result = readDashboardActivity(db, now)
    expect(result.activeMinutes).toBe(0.5)
    expect(result.days[0]).toMatchObject({ events: 2, activeMinutes: 0.5 })
  })
})
