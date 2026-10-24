import type { Task } from '@shared/types'

const DAY = 86_400_000

/** Date and time inputs ("2026-10-24", "14:30" or "") to a due time; without a time it's 9:00 that day. */
export function dueFrom(date: string, time: string): { dueAt?: number; dueHasTime?: boolean } {
  if (!date) return { dueAt: undefined, dueHasTime: undefined }
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time ? time.split(':').map(Number) : [9, 0]
  return { dueAt: new Date(y, m - 1, d, hh, mm).getTime(), dueHasTime: !!time }
}

/** A due time back to date and time input values. */
export function dueInputs(t: Pick<Task, 'dueAt' | 'dueHasTime'> | undefined): { date: string; time: string } {
  if (!t?.dueAt) return { date: '', time: '' }
  const d = new Date(t.dueAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: t.dueHasTime ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '' }
}

/** "Today 14:00", "Tomorrow", "Fri", "Oct 30", or "2 days late", with a tone for coloring. */
export function dueLabel(t: Pick<Task, 'dueAt' | 'dueHasTime'>, now = Date.now()): { text: string; tone: '' | 'soon' | 'late' } {
  if (!t.dueAt) return { text: '', tone: '' }
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const day = Math.floor((t.dueAt - start.getTime()) / DAY)
  const time = t.dueHasTime ? ` ${new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
  if (day < 0) return { text: day === -1 ? 'Yesterday' : `${-day} days late`, tone: 'late' }
  if (day === 0) return { text: `Today${time}`, tone: t.dueAt < now ? 'late' : 'soon' }
  if (day === 1) return { text: `Tomorrow${time}`, tone: 'soon' }
  if (day < 7) return { text: new Date(t.dueAt).toLocaleDateString([], { weekday: 'short' }) + time, tone: '' }
  return { text: new Date(t.dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' }), tone: '' }
}
