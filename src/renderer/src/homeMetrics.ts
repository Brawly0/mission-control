import type { DashboardDay } from '@shared/types'

export type UsageRange = 'week' | 'month' | 'all'
export const DAY = 86_400_000
export const TIME_HINT = 'Estimated from gaps of up to 15 minutes between indexed events within each session. Parallel chats can overlap; this is not billed or tracked work time.'
export function dayKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export function calendarDay(date: Date, offset: number): Date { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d }
export function weekStart(date: Date): Date { return calendarDay(date, -((date.getDay() + 6) % 7)) }
export function timeLabel(minutes: number): string { const n = Math.round(minutes); return minutes > 0 && !n ? '<1m' : n < 60 ? `${n}m` : `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}` }

export function activityPeriod(days: DashboardDay[], range: UsageRange, now: Date) {
  const end = calendarDay(now, 1), earliest = days.map(d => d.day).sort()[0]
  const start = range === 'week' ? weekStart(now) : range === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : earliest ? new Date(earliest + 'T00:00:00') : calendarDay(now, 0)
  const selected = days.filter(d => d.day >= dayKey(start) && d.day < dayKey(end))
  const providers = { claude: { minutes: 0, events: 0 }, codex: { minutes: 0, events: 0 } }
  for (const day of selected) { providers[day.tool].minutes += day.activeMinutes; providers[day.tool].events += day.events }
  const minutes = providers.claude.minutes + providers.codex.minutes, events = providers.claude.events + providers.codex.events
  const format = (date: Date) => date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  const label = `${range === 'week' ? 'This week' : range === 'month' ? 'This month' : 'All indexed history'} · ${format(start)} – ${format(now)}`
  return { start, end, days: selected, providers, minutes, events, label }
}

export function durationPresentation(minutes: number, events: number) {
  return minutes > 0 ? { value: timeLabel(minutes), note: 'Estimated active chat time' }
    : events > 0 ? { value: '0m', note: `${events} activity events; no measurable duration` }
      : { value: '—', note: 'No activity in this period' }
}

export function comparisonLabel(current: number, previous: number): string | null {
  return current > 0 && previous > 0 ? `${current >= previous ? '+' : ''}${Math.round((current / previous - 1) * 100)}% vs last week · est.` : null
}
