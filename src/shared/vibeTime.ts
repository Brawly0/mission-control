import type { AgentTool, VibeTime } from './types'

/** Two messages in one chat at most this far apart count as time spent in that chat. */
export const VIBE_GAP_MS = 15 * 60_000

export interface VibeEvent {
  session: string
  tool: AgentTool
  ts: number
}

type Span = [number, number]

function localDay(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Sorted, non-overlapping union of spans. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  const out: Span[] = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

const length = (spans: Span[]) => spans.reduce((n, [s, e]) => n + e - s, 0)

/** Calls `fn` for each piece of a span cut at local hour boundaries (DST-safe: uses the local clock). */
function eachHour(s: number, e: number, fn: (from: number, to: number) => void): void {
  let from = s
  while (from < e) {
    const next = new Date(from)
    next.setMinutes(60, 0, 0)
    const to = Math.min(e, next.getTime())
    fn(from, to)
    from = to
  }
}

/**
 * Time spent vibe coding, from chat message timestamps. Within one chat, the time between two
 * messages at most 15 minutes apart counts; longer gaps count as a break. Chats that overlap
 * (several agents at once) count once, so the total is wall-clock time, never more than the hours
 * that passed. Days and hours are local time; a span crossing midnight is split between the days.
 */
export function vibeTime(events: VibeEvent[], now = Date.now()): VibeTime {
  const bySession = new Map<string, { tool: AgentTool; ts: number[] }>()
  const days = new Set<string>()
  let firstAt = 0
  for (const e of events) {
    if (!Number.isFinite(e.ts) || e.ts <= 0 || e.ts > now) continue
    let s = bySession.get(e.session)
    if (!s) bySession.set(e.session, (s = { tool: e.tool, ts: [] }))
    s.ts.push(e.ts)
    days.add(localDay(e.ts))
    if (!firstAt || e.ts < firstAt) firstAt = e.ts
  }

  const all: Span[] = []
  const perTool: Record<AgentTool, Span[]> = { claude: [], codex: [] }
  let perChatMs = 0
  for (const s of bySession.values()) {
    const ts = [...new Set(s.ts)].sort((a, b) => a - b)
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - ts[i - 1]
      if (gap > VIBE_GAP_MS) continue
      const span: Span = [ts[i - 1], ts[i]]
      all.push(span)
      perTool[s.tool].push(span)
      perChatMs += gap
    }
  }
  const merged = merge(all)
  const totalMs = length(merged)

  const dayMs = new Map<string, number>()
  const hourMs = new Array<number>(24).fill(0)
  for (const [s, e] of merged) {
    eachHour(s, e, (from, to) => {
      const day = localDay(from)
      dayMs.set(day, (dayMs.get(day) ?? 0) + to - from)
      hourMs[new Date(from).getHours()] += to - from
    })
  }

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const monday = new Date(today)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const todayKey = localDay(today.getTime())
  const mondayKey = localDay(monday.getTime())
  const lastMonday = new Date(monday)
  lastMonday.setDate(lastMonday.getDate() - 7)
  const lastMondayKey = localDay(lastMonday.getTime())
  let weekMs = 0
  let lastWeekMs = 0
  let longest = { day: '', minutes: 0 }
  for (const [day, ms] of dayMs) {
    if (day >= mondayKey) weekMs += ms
    else if (day >= lastMondayKey) lastWeekMs += ms
    if (ms > longest.minutes * 60_000 || (ms === longest.minutes * 60_000 && day > longest.day)) longest = { day, minutes: ms / 60_000 }
  }

  // Streaks of calendar days with at least one message.
  const sortedDays = [...days].sort()
  const nextDay = (key: string) => {
    const d = new Date(key + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return localDay(d.getTime())
  }
  let longestStreak = { days: 0, from: '', to: '' }
  let run = { days: 0, from: '', to: '' }
  for (const day of sortedDays) {
    run = run.days && nextDay(run.to) === day ? { ...run, days: run.days + 1, to: day } : { days: 1, from: day, to: day }
    if (run.days > longestStreak.days) longestStreak = { ...run }
  }
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const currentStreak = run.days && (run.to === todayKey || run.to === localDay(yesterday.getTime())) ? run.days : 0

  const busiest = hourMs.reduce((best, ms, h) => (ms > hourMs[best] ? h : best), 0)
  return {
    minutes: totalMs / 60_000,
    claudeMinutes: length(merge(perTool.claude)) / 60_000,
    codexMinutes: length(merge(perTool.codex)) / 60_000,
    parallelMinutes: (perChatMs - totalMs) / 60_000,
    todayMinutes: (dayMs.get(todayKey) ?? 0) / 60_000,
    weekMinutes: weekMs / 60_000,
    lastWeekMinutes: lastWeekMs / 60_000,
    activeDays: days.size,
    longestDay: longest.day ? longest : null,
    longestStreak: longestStreak.days ? longestStreak : null,
    currentStreak,
    busiestHour: hourMs[busiest] > 0 ? { hour: busiest, minutes: hourMs[busiest] / 60_000 } : null,
    firstAt
  }
}
