import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { Schedule, Task, TaskTemplate, TemplateInput } from '../shared/types'
import { loadStore, updateStore } from './store'
import { createTask, pumpQueue, startTask, updateTask } from './tasks'

/**
 * Task templates and the scheduler for recurring ones.
 * The scheduler only runs while Mission Control is open (it lives in the tray when the window is
 * closed). A template that came due while the app was closed runs once at the next start, not once
 * for every missed occurrence.
 */

interface Hooks {
  onChange: (templates: TaskTemplate[]) => void
  /** An interactive task needs the UI to open its agent. */
  onLaunchInteractive: (taskId: string) => void
  onFired: (template: TaskTemplate, task: Task) => void
}

let hooks: Hooks | null = null
let timer: NodeJS.Timeout | null = null

export function listTemplates(): TaskTemplate[] {
  return loadStore().templates
}

function save(templates: TaskTemplate[]): void {
  updateStore((s) => {
    s.templates = templates
  })
  hooks?.onChange(templates)
}

// ---------------------------------------------------------------- schedule math

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

/** Fills {{project}}, {{date}}, {{time}}, {{weekday}} in a template's text. */
export function fillVariables(text: string, projectName: string, now = new Date()): string {
  const vars: Record<string, string> = {
    project: projectName,
    date: now.toLocaleDateString('en-CA'),
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, name: string) => vars[name.toLowerCase()] ?? all)
}

// ---------------------------------------------------------------- CRUD

export function saveTemplate(input: TemplateInput, id?: string): TaskTemplate {
  if (input.schedule?.enabled && !input.projectPath) throw new Error('A recurring template needs a project.')
  const templates = listTemplates()
  const now = Date.now()
  const existing = id ? templates.find((t) => t.id === id) : undefined
  const schedule = input.schedule
    ? {
        ...input.schedule,
        lastRunAt: existing?.schedule?.lastRunAt,
        // Recompute when the timing changed or it was just turned on.
        nextRunAt: input.schedule.enabled ? nextRunAfter(input.schedule, now) : undefined
      }
    : undefined
  const template: TaskTemplate = {
    ...input,
    projectName: input.projectPath ? (input.projectName ?? basename(input.projectPath)) : undefined,
    schedule,
    id: existing?.id ?? randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  save(existing ? templates.map((t) => (t.id === template.id ? template : t)) : [...templates, template])
  return template
}

export function deleteTemplate(id: string): void {
  save(listTemplates().filter((t) => t.id !== id))
}

/** Creates a task from a template, then starts it, queues it, or leaves it in To do. */
export async function runTemplate(id: string, then: Schedule['then'], projectPath?: string): Promise<Task> {
  const tpl = listTemplates().find((t) => t.id === id)
  if (!tpl) throw new Error('Template not found')
  const path = projectPath ?? tpl.projectPath
  if (!path) throw new Error('Pick a project for this template.')
  const projectName = projectPath ? basename(projectPath) : (tpl.projectName ?? basename(path))
  const task = createTask({
    title: fillVariables(tpl.title || tpl.name, projectName),
    prompt: fillVariables(tpl.prompt, projectName),
    projectPath: path,
    projectName,
    mode: tpl.mode,
    permission: tpl.permission,
    useWorktree: tpl.useWorktree,
    budgetUsd: tpl.budgetUsd,
    model: tpl.model,
    templateId: tpl.id,
    queued: then === 'queue'
  })
  if (then === 'start') {
    if (task.mode === 'interactive') hooks?.onLaunchInteractive(task.id)
    else await startTask(task.id)
  } else if (then === 'queue' && task.mode === 'interactive') {
    // Interactive tasks can't run unattended; leave them in To do.
    updateTask(task.id, { queued: false })
  } else if (then === 'queue') {
    void pumpQueue()
  }
  return task
}

// ---------------------------------------------------------------- scheduler

/** Runs every template that is due now. Exported for the self-test. */
export async function runDueTemplates(): Promise<void> {
  return tick()
}

async function tick(): Promise<void> {
  const now = Date.now()
  const templates = listTemplates()
  let changed = false
  for (const tpl of templates) {
    const s = tpl.schedule
    if (!s?.enabled) continue
    if (!s.nextRunAt) {
      s.nextRunAt = nextRunAfter(s, now)
      changed = true
      continue
    }
    if (s.nextRunAt > now) continue
    // Due (or missed while the app was closed): run once, then plan the next one from now.
    s.lastRunAt = now
    s.nextRunAt = nextRunAfter(s, now)
    changed = true
    try {
      const task = await runTemplate(tpl.id, s.then)
      hooks?.onFired(tpl, task)
    } catch (err) {
      console.warn(`Recurring template "${tpl.name}" failed:`, (err as Error).message)
    }
  }
  if (changed) {
    // runTemplate may have saved in between; merge schedule fields into the latest list.
    const latest = listTemplates().map((t) => {
      const mine = templates.find((x) => x.id === t.id)
      return mine?.schedule && t.schedule ? { ...t, schedule: { ...t.schedule, lastRunAt: mine.schedule.lastRunAt, nextRunAt: mine.schedule.nextRunAt } } : t
    })
    save(latest)
  }
}

/** Connects template changes to the UI; with `runTimer` false (self-tests) nothing fires on its own. */
export function startScheduler(h: Hooks, runTimer = true): void {
  hooks = h
  if (!runTimer) return
  timer = setInterval(() => void tick(), 30_000)
  setTimeout(() => void tick(), 5000)
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
}
