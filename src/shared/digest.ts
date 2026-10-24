import type { Digest } from './types'
import { formatShare } from './planCost'

/** Local day key, "2026-10-24". */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Midnight (local) of the day `ms` falls in, plus `days`. */
export function startOfDay(ms: number, days = 0): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** True when today's digest should show: the set time ("HH:MM") has passed and it hasn't shown today. */
export function digestDue(now: number, time: string, shownDay: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return false
  const at = new Date(now)
  at.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return now >= at.getTime() && shownDay !== dayKey(now)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** True when there's nothing to say: no usage, nothing finished, nothing waiting. */
export function digestEmpty(d: Digest): boolean {
  return !d.chats && !d.tasksFinished && !d.tasksFailed && !d.review && !d.dueToday.length && !d.overdue
}

/** Title and body for the digest notification. */
export function digestText(d: Digest): { title: string; body: string } {
  const when = d.label === 'yesterday' ? 'Yesterday' : 'Today so far'
  const parts: string[] = []
  if (d.chats) parts.push(`${plural(d.chats, 'chat')}${d.weekShare !== undefined ? `, ≈${formatShare(d.weekShare)} of your week` : ''}`)
  else parts.push('no chats')
  if (d.tasksFinished) parts.push(`${plural(d.tasksFinished, 'task')} finished${d.tasksFailed ? ` (${d.tasksFailed} with problems)` : ''}`)
  if (d.briefings) parts.push(plural(d.briefings, 'briefing'))
  const now: string[] = []
  if (d.review) now.push(`${d.review} to review`)
  if (d.overdue) now.push(`${d.overdue} overdue`)
  if (d.dueToday.length) now.push(`${d.dueToday.length} due today`)
  if (d.week) now.push(`week at ${Math.round(d.week.utilization * 100)}%`)
  return {
    title: `Your daily digest: ${when.toLowerCase()} in Mission Control`,
    body: [`${when}: ${parts.join(' · ')}.`, now.length ? `Now: ${now.join(' · ')}.` : ''].filter(Boolean).join(' ')
  }
}
