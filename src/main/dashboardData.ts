import type { DatabaseSync } from 'node:sqlite'
import type { AgentTool, DashboardActivity, DashboardDay } from '../shared/types'

const ACTIVE_GAP_MS = 15 * 60_000

interface ActivityEvent {
  session_id: string
  tool: AgentTool
  ts: number
  previous_ts: number | null
}

/**
 * Activity is estimated from indexed chat events, not elapsed work or billing time.
 * Equal timestamps in one session count once. A gap of at most 15 minutes counts
 * toward the later event's local day, clamped to that day's midnight. Single
 * events still count as active chats/days, but do not invent any active minutes.
 */
export function readDashboardActivity(db: DatabaseSync, now = Date.now()): DashboardActivity {
  const rows = db.prepare(`
    WITH observed AS (
      SELECT DISTINCT f.session_id,
        CASE WHEN s.project_key = 'codex' THEN 'codex' ELSE 'claude' END AS tool,
        CAST(f.ts AS INTEGER) AS ts
      FROM fts f JOIN sessions s ON s.session_id = f.session_id
      WHERE f.role IN ('user', 'assistant')
        AND (
          (typeof(f.ts) IN ('integer', 'real') AND f.ts = CAST(f.ts AS INTEGER))
          OR (trim(CAST(f.ts AS TEXT)) <> '' AND trim(CAST(f.ts AS TEXT)) NOT GLOB '*[^0-9]*')
        )
        AND CAST(f.ts AS INTEGER) > 0 AND CAST(f.ts AS INTEGER) <= ?
    )
    SELECT session_id, tool, ts,
      LAG(ts) OVER (PARTITION BY session_id ORDER BY ts) AS previous_ts
    FROM observed ORDER BY ts, session_id
  `).all(now) as unknown as ActivityEvent[]

  const sessions = new Set<string>()
  const activeDays = new Set<string>()
  const days = new Map<string, { day: DashboardDay; sessions: Set<string>; activeMs: number }>()
  let activeMs = 0
  for (const event of rows) {
    const date = new Date(event.ts)
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const key = `${day}:${event.tool}`
    let entry = days.get(key)
    if (!entry) {
      entry = { day: { day, tool: event.tool, sessions: 0, events: 0, activeMinutes: 0 }, sessions: new Set(), activeMs: 0 }
      days.set(key, entry)
    }
    sessions.add(event.session_id)
    activeDays.add(day)
    entry.sessions.add(event.session_id)
    entry.day.events++
    const gap = event.previous_ts === null ? 0 : event.ts - event.previous_ts
    if (gap > 0 && gap <= ACTIVE_GAP_MS) {
      const midnight = new Date(event.ts)
      midnight.setHours(0, 0, 0, 0)
      const elapsed = Math.min(gap, event.ts - midnight.getTime())
      entry.activeMs += elapsed
      activeMs += elapsed
    }
  }
  return {
    days: [...days.values()].map(entry => ({ ...entry.day, sessions: entry.sessions.size, activeMinutes: entry.activeMs / 60_000 }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.tool.localeCompare(b.tool)),
    sessions: sessions.size,
    activeDays: activeDays.size,
    activeMinutes: activeMs / 60_000
  }
}
