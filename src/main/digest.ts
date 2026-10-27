import type { Digest } from '../shared/types'
import { dayKey, digestDue, digestEmpty, digestText, startOfDay } from '../shared/digest'
import { planShare } from '../shared/planCost'
import { paceText } from '../shared/planUsage'
import { taskFailed } from '../shared/deps'
import { queryIndex } from './indexer'
import { getRateLimit, listTasks } from './tasks'
import { planRate } from './planCost'
import { loadStore, updateStore } from './store'
import { movedChatList } from './claudeData'

/**
 * The daily digest: yesterday (or today so far) in review, plus what's waiting now. Shown on the
 * Inbox page, and once a day as a notification at the time set in Settings.
 */
export async function buildDigest(which: 'yesterday' | 'today'): Promise<Digest> {
  const now = Date.now()
  const from = startOfDay(now, which === 'yesterday' ? -1 : 0)
  const to = which === 'yesterday' ? startOfDay(now) : now
  const usage = await queryIndex<Pick<Digest, 'chats' | 'replies' | 'costUsd' | 'topProjects' | 'topChats' | 'briefings'>>('dayDigest', from, to)
  const rate = await planRate().catch(() => null)

  // Chats shown under another project (started from C:\, or moved by you) link to that project.
  const moved = new Map(movedChatList().map((m) => [m.id, m.path]))
  const topChats = usage.topChats.map((c) => ({ ...c, projectPath: moved.get(c.sessionId) ?? c.projectPath, title: loadStore().chatTitles[c.sessionId] || loadStore().chatAiNames[c.sessionId] || c.title }))

  const tasks = listTasks().filter(t => !t.teamParentId)
  const finished = tasks.filter((t) => t.run?.finishedAt && t.run.finishedAt >= from && t.run.finishedAt < to)
  const endOfToday = startOfDay(now, 1)
  const open = tasks.filter((t) => t.column !== 'done' && t.dueAt)
  const week = getRateLimit()?.windows.find((w) => w.name === 'seven_day')
  return {
    ...usage,
    topChats,
    day: dayKey(from),
    label: which,
    from,
    to,
    weekShare: planShare(usage.costUsd, rate),
    tasksFinished: finished.length,
    tasksFailed: finished.filter(taskFailed).length,
    review: tasks.filter((t) => t.column === 'review').length,
    dueToday: open.filter((t) => t.dueAt! >= now && t.dueAt! < endOfToday).map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt! })),
    overdue: open.filter((t) => t.dueAt! < now).length,
    week: week ? { utilization: week.utilization, resetsAt: week.resetsAt, pace: paceText(week, now) } : undefined,
    generatedAt: now
  }
}

/** Shows today's digest once its time has passed (checked every minute); returns it when it should be shown. */
export async function checkDigest(): Promise<{ title: string; body: string } | null> {
  const { settings, digestShown } = loadStore()
  const now = Date.now()
  if (!digestDue(now, settings.digestTime, digestShown)) return null
  updateStore((s) => {
    s.digestShown = dayKey(now)
  })
  const d = await buildDigest('yesterday').catch(() => null)
  return d && !digestEmpty(d) ? digestText(d) : null
}
