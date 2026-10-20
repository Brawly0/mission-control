import type { Schedule } from './types'

/** Pure schedule math and template variables (no Electron), shared and unit-tested. */

function parseTime(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  const h = m ? Math.min(23, Number(m[1])) : 9
  const min = m ? Math.min(59, Number(m[2])) : 0
  return [h, min]
}

/** The next time a schedule fires after `from` (ms). */
export function nextRunAfter(s: Schedule, from: number): number {
  if (s.kind === 'hourly') {
    const hours = Math.max(1, Math.min(168, s.everyHours ?? 1))
    return from + hours * 3_600_000
  }
  const [h, m] = parseTime(s.time)
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setHours(h, m)
  if (d.getTime() <= from) d.setDate(d.getDate() + 1)
  for (let i = 0; i < 8; i++) {
    const day = d.getDay()
    const ok = s.kind === 'daily' || (s.kind === 'weekdays' && day >= 1 && day <= 5) || (s.kind === 'weekly' && day === (s.weekday ?? 1))
    if (ok) return d.getTime()
    d.setDate(d.getDate() + 1)
  }
  return d.getTime()
}

/** Fills {{project}}, {{date}}, {{time}}, {{weekday}} in a template's text; unknown names stay as written. */
export function fillVariables(text: string, projectName: string, now = new Date()): string {
  const vars: Record<string, string> = {
    project: projectName,
    date: now.toLocaleDateString('en-CA'),
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, name: string) => vars[name.toLowerCase()] ?? all)
}
