import type { BudgetState, Project, QueueStatus, RateLimitInfo, Task, UpdateState } from '@shared/types'
import { taskFailed } from '@shared/deps'
import { windowLabel } from '@shared/planUsage'
import { dayKey } from '@shared/digest'
import type { Agent } from './types'

/**
 * The "Needs you" inbox: everything across Mission Control that waits on you, in one list.
 * Items are worked out from live state (agents, tasks, plan limits…), so they go away by
 * themselves once dealt with. Dismissing one hides it until something new happens: each key
 * includes what changed (a finish time, a reset, a version).
 */

export type InboxSeverity = 'urgent' | 'normal' | 'info'

export type InboxAction =
  | { kind: 'agent'; agentId: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'view'; view: 'usage' | 'tasks' | 'agents' }
  | { kind: 'project'; path: string }
  | { kind: 'update' }
  | { kind: 'restore' }

export interface InboxItem {
  key: string
  severity: InboxSeverity
  /** What it's about, for the icon. */
  kind: 'agent' | 'review' | 'failed' | 'due' | 'limit' | 'budget' | 'update' | 'queue' | 'restore' | 'login'
  title: string
  detail: string
  /** When it happened (for sorting and "5m ago"); 0 if it's a standing state. */
  at: number
  action: InboxAction
  actionLabel: string
  /** Project it belongs to, for the avatar. */
  projectPath?: string
  /** Live states (an agent asking for permission) can't be dismissed; they end when you act. */
  dismissable: boolean
  /** Extra button, e.g. "Mark done" on a finished task. */
  secondary?: { label: string; action: 'taskDone' }
}

export interface InboxInput {
  now: number
  agents: Agent[]
  tasks: Task[]
  rateLimit: RateLimitInfo | null
  /** Settings → Spending alert level (percent); 0 = off. */
  planAlertPercent: number
  budgets: Record<string, BudgetState>
  projects: Project[]
  update: UpdateState
  queue: QueueStatus | null
  restoreCount: number
}

const SEVERITY_ORDER: Record<InboxSeverity, number> = { urgent: 0, normal: 1, info: 2 }

function projectName(projects: Project[], key: string): string {
  const p = projects.find((x) => x.path.toLowerCase().replace(/[\\/]+$/, '') === key)
  return p?.name ?? key.split(/[\\/]/).filter(Boolean).pop() ?? key
}

export function inboxItems(input: InboxInput): InboxItem[] {
  const { now } = input
  const items: InboxItem[] = []

  for (const a of input.agents) {
    if (a.exited || a.kind !== 'claude') continue
    if (a.hookStatus === 'needs-input') {
      items.push({
        key: `agent:${a.id}:input`,
        severity: 'urgent',
        kind: 'agent',
        title: a.title,
        detail: a.statusMessage || 'Claude needs your input.',
        at: a.statusAt ?? a.startedAt,
        action: { kind: 'agent', agentId: a.id },
        actionLabel: 'Open',
        projectPath: a.projectPath,
        dismissable: false
      })
    } else if (a.hookStatus === 'done') {
      items.push({
        key: `agent:${a.id}:done:${a.statusAt ?? 0}`,
        severity: 'normal',
        kind: 'agent',
        title: a.title,
        detail: 'Finished its turn. Your move.',
        at: a.statusAt ?? a.startedAt,
        action: { kind: 'agent', agentId: a.id },
        actionLabel: 'Open',
        projectPath: a.projectPath,
        dismissable: true
      })
    }
  }

  for (const t of input.tasks) {
    const run = t.run
    if (t.column === 'review' && run?.finishedAt) {
      const failed = taskFailed(t)
      const checks = run.checks
      items.push({
        key: `task:${t.id}:${run.finishedAt}`,
        severity: failed ? 'urgent' : 'normal',
        kind: failed ? 'failed' : 'review',
        title: t.title,
        detail: run.error
          ? `Stopped: ${run.error.slice(0, 140)}`
          : checks?.status === 'failed' || checks?.status === 'error'
            ? `Finished, but checks failed (${checks.command}).`
            : checks?.status === 'passed'
              ? 'Finished and checks passed. Ready for review.'
              : 'Finished. Ready for review.',
        at: run.finishedAt,
        action: { kind: 'task', taskId: t.id },
        actionLabel: 'Review',
        projectPath: t.projectPath,
        dismissable: true,
        secondary: failed ? undefined : { label: 'Mark done', action: 'taskDone' }
      })
    }
    if (t.column !== 'done' && t.dueAt) {
      const overdue = t.dueAt <= now
      const today = new Date(now)
      today.setHours(24, 0, 0, 0)
      if (overdue || t.dueAt < today.getTime()) {
        items.push({
          key: `due:${t.id}:${t.dueAt}`,
          severity: overdue ? 'urgent' : 'normal',
          kind: 'due',
          title: t.title,
          detail: `${overdue ? 'Overdue since' : 'Due today at'} ${new Date(t.dueAt).toLocaleString([], overdue && now - t.dueAt > 86_400_000 ? { weekday: 'short', month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' })}${t.column === 'running' ? ' (running now)' : ''}.`,
          at: t.dueAt,
          action: { kind: 'task', taskId: t.id },
          actionLabel: 'Open',
          projectPath: t.projectPath,
          dismissable: true
        })
      }
    }
  }

  const rl = input.rateLimit
  for (const w of rl?.windows ?? []) {
    const pct = Math.round(w.utilization * 100)
    const soon = w.name === 'five_hour' ? 3_600_000 : 86_400_000
    const pace = !!w.forecast?.runsOutAt && w.forecast.runsOutAt - now < soon && pct < 100
    const level = input.planAlertPercent || 80
    const kind = pct >= 100 ? 'out' : pct >= level ? 'near' : pace ? 'pace' : ''
    if (!kind) continue
    const resets = w.resetsAt ? new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon'
    items.push({
      key: `limit:${w.name}@${Math.round(w.resetsAt / 60_000)}:${kind}`,
      severity: kind === 'out' ? 'urgent' : 'normal',
      kind: 'limit',
      title:
        kind === 'out'
          ? `${windowLabel(w.name, true)} limit reached`
          : kind === 'pace'
            ? `${windowLabel(w.name, true)} limit runs out ~${new Date(w.forecast!.runsOutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} at this pace`
            : `${windowLabel(w.name, true)} limit at ${pct}%`,
      detail: kind === 'out' ? `Claude is paused until it resets (${resets}).` : `${pct}% used, resets ${resets}. Eco mode, smaller models and fresh chats make what's left go further.`,
      at: 0,
      action: { kind: 'view', view: 'usage' },
      actionLabel: 'See usage',
      dismissable: true
    })
  }
  if (rl?.error && !rl.windows.length) {
    items.push({
      key: `login:${rl.error}`,
      severity: 'info',
      kind: 'login',
      title: "Can't read your plan limits",
      detail: rl.error,
      at: rl.at,
      action: { kind: 'view', view: 'usage' },
      actionLabel: 'See usage',
      dismissable: true
    })
  }

  const month = dayKey(now).slice(0, 7)
  for (const [key, b] of Object.entries(input.budgets)) {
    if (b.ratio < 0.8) continue
    const name = projectName(input.projects, key)
    items.push({
      key: `budget:${key}:${month}:${b.over ? 'over' : 'near'}`,
      severity: b.over ? 'urgent' : 'normal',
      kind: 'budget',
      title: b.over ? `${name} is over its monthly budget` : `${name} has used ${Math.round(b.ratio * 100)}% of its monthly budget`,
      detail: `About $${b.spent.toFixed(2)} of $${b.budget} this month (estimated at API prices).${b.over ? ' Automation for this project is on hold.' : ''}`,
      at: 0,
      action: { kind: 'project', path: input.projects.find((p) => p.path.toLowerCase().replace(/[\\/]+$/, '') === key)?.path ?? key },
      actionLabel: 'Open project',
      projectPath: key,
      dismissable: true
    })
  }

  const q = input.queue
  if (q?.enabled && q.queued > 0 && q.heldBecause) {
    items.push({
      key: `queue:${q.heldBecause}`,
      severity: 'normal',
      kind: 'queue',
      title: `The queue is on hold (${q.queued} waiting)`,
      detail: q.heldBecause,
      at: 0,
      action: { kind: 'view', view: 'tasks' },
      actionLabel: 'Open tasks',
      dismissable: true
    })
  }

  if (input.update.state === 'ready') {
    items.push({
      key: `update:${input.update.version}`,
      severity: 'info',
      kind: 'update',
      title: `Mission Control ${input.update.version} is ready`,
      detail: 'Restart to update. Open agents are offered for restore afterwards.',
      at: 0,
      action: { kind: 'update' },
      actionLabel: 'Restart now',
      dismissable: true
    })
  }

  if (input.restoreCount > 0) {
    items.push({
      key: 'restore',
      severity: 'info',
      kind: 'restore',
      title: `${input.restoreCount} ${input.restoreCount === 1 ? 'agent was' : 'agents were'} open when you last closed Mission Control`,
      detail: 'Reopen them where they left off.',
      at: 0,
      action: { kind: 'restore' },
      actionLabel: 'Restore',
      dismissable: false
    })
  }

  // Most pressing first; within a level, newest first, standing states after events.
  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.at - a.at)
}

/** An item as listed: `hidden` when you dismissed it (shown only with "Show dismissed"). */
export type ShownItem = InboxItem & { hidden?: boolean }

/** Items still showing after your dismissals; with `showHidden`, dismissed ones are kept and marked. */
export function visibleInbox(items: InboxItem[], dismissed: Iterable<string>, showHidden = false): ShownItem[] {
  const gone = new Set(dismissed)
  const marked = items.map((i) => (i.dismissable && gone.has(i.key) ? { ...i, hidden: true } : i))
  return showHidden ? marked : marked.filter((i) => !(i as ShownItem).hidden)
}

/** What the sidebar badge counts: urgent and normal items (not "info"). */
export function inboxCount(items: InboxItem[]): { total: number; urgent: number } {
  const counted = items.filter((i) => i.severity !== 'info')
  return { total: counted.length, urgent: counted.filter((i) => i.severity === 'urgent').length }
}
