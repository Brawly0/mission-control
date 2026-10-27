import { useState } from 'react'
import { CalendarClock, Copy, FileStack, ListOrdered, ListPlus, Pencil, Play, Plus, Repeat, Trash2, X } from 'lucide-react'
import type { Project, Schedule, TaskMode, TaskPermission, TaskTemplate, TemplateInput } from '@shared/types'
import { errorMessage, timeAgo } from '../util'
import { useToast } from '../toast'
import { Avatar, Button, EmptyState, IconButton, Segmented } from './ui'

interface Props {
  templates: TaskTemplate[]
  projects: Project[]
  onClose: () => void
  /** Opens the New task dialog prefilled from a template. */
  onUse: (tpl: TaskTemplate) => void
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function describeSchedule(s?: Schedule): string {
  if (!s) return 'Manual'
  const at = `at ${s.time}`
  switch (s.kind) {
    case 'hourly':
      return `Every ${s.everyHours ?? 1} ${(s.everyHours ?? 1) === 1 ? 'hour' : 'hours'}`
    case 'daily':
      return `Every day ${at}`
    case 'weekdays':
      return `Weekdays ${at}`
    case 'weekly':
      return `Every ${WEEKDAYS[s.weekday ?? 1]} ${at}`
  }
}

function inFuture(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 60_000) return 'in a moment'
  const m = Math.round(diff / 60_000)
  if (m < 60) return `in ${m}m`
  const h = Math.round(m / 60)
  if (h < 36) return `in ${h}h`
  return new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

const blank: TemplateInput = { name: '', title: '', prompt: '', mode: 'headless', permission: 'auto', useWorktree: false }

function TemplateEditor({ initial, id, projects, onDone }: { initial: TemplateInput; id?: string; projects: Project[]; onDone: () => void }) {
  const toast = useToast()
  const [t, setT] = useState<TemplateInput>(initial)
  const [recurring, setRecurring] = useState(!!initial.schedule)
  const [schedule, setSchedule] = useState<Schedule>(initial.schedule ?? { enabled: true, kind: 'daily', time: '09:00', then: 'start' })
  const choices = projects.filter((p) => !p.worktree)
  const set = (patch: Partial<TemplateInput>) => setT((cur) => ({ ...cur, ...patch }))

  const save = async () => {
    try {
      const project = choices.find((p) => p.path === t.projectPath)
      await window.mc.saveTemplate({ ...t, name: t.name.trim() || t.title.trim() || 'Untitled template', projectName: project?.name, schedule: recurring ? schedule : undefined }, id)
      toast('success', id ? 'Template saved' : 'Template created')
      onDone()
    } catch (e) {
      toast('error', 'Could not save the template', errorMessage(e))
    }
  }

  return (
    <div className="dialog-body template-editor">
      <div className="field-row">
        <label className="field grow">
          <span className="field-label">Template name</span>
          <input className="text-input" autoFocus placeholder="e.g. Morning dependency check" value={t.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Project</span>
          <select className="select" value={t.projectPath ?? ''} onChange={(e) => set({ projectPath: e.target.value || undefined })}>
            <option value="">Choose when used</option>
            {choices.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field"><span className="field-label">Agent</span><select className="select" value={t.tool ?? 'claude'} onChange={e => set({tool: e.target.value as 'claude' | 'codex', model: undefined, budgetUsd: undefined})}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
      <label className="field">
        <span className="field-label">Task title</span>
        <input className="text-input" placeholder="e.g. Dependency check for {{project}} on {{date}}" value={t.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="field">
        <span className="field-label">Prompt</span>
        <textarea className="prompt-input" rows={5} placeholder="What the agent should do each time." value={t.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        <span className="field-hint">
          You can use <code>{'{{project}}'}</code>, <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code> and <code>{'{{weekday}}'}</code>. They’re filled in when the task is made.
        </span>
      </label>
      <div className="field-row">
        <div className="field">
          <span className="field-label">Run as</span>
          <Segmented<TaskMode>
            value={t.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'headless', label: 'Headless' },
              { value: 'interactive', label: 'Interactive' }
            ]}
          />
        </div>
        <label className="field">
          <span className="field-label">Permissions</span>
          <select className="select" value={t.permission} onChange={(e) => set({ permission: e.target.value as TaskPermission })}>
            <option value="auto">Auto (recommended)</option>
            <option value="acceptEdits">Accept edits</option>
            <option value="plan">Plan only</option>
            <option value="bypassPermissions">Bypass all checks</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          {t.tool === 'codex' ? <input className="text-input" placeholder="Codex default" value={t.model ?? ''} onChange={e => set({model: e.target.value || undefined})} /> : <select className="select" value={t.model ?? ''} onChange={(e) => set({ model: e.target.value || undefined })}>
            <option value="">Default</option>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
          </select>}
        </label>
        <label className="field budget-field">
          <span className="field-label">Budget (USD)</span>
          <input
            className="text-input"
            type="number"
            min="0"
            step="0.5"
            placeholder="No limit"
            disabled={t.tool === 'codex'}
            value={t.budgetUsd ?? ''}
            onChange={(e) => set({ budgetUsd: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
          />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={t.useWorktree} onChange={(e) => set({ useWorktree: e.target.checked })} />
        <span>
          Run each task in its own worktree
          <span className="field-hint block">Only takes effect in git repositories.</span>
        </span>
      </label>

      <div className="schedule-box">
        <div className="steps-head">
          <ListOrdered size={14} />
          <span className="strong">Pipeline steps</span>
          <span className="muted small">Optional. Each step runs after the one before it succeeds (and its checks pass), building on its branch in a worktree.</span>
        </div>
        <ol className="steps">
          <li className="muted small">1. The prompt above</li>
          {(t.steps ?? []).map((step, i) => (
            <li key={i} className="step">
              <span className="step-no">{i + 2}.</span>
              <select aria-label={`Agent for step ${i + 2}`} className="select select-sm" value={step.tool ?? t.tool ?? 'claude'} onChange={e => set({steps: t.steps!.map((s,j) => j === i ? {...s,tool:e.target.value as 'claude'|'codex'} : s)})}><option value="claude">Claude</option><option value="codex">Codex</option></select>
              <label className="small"><input type="checkbox" checked={step.permission === 'plan'} onChange={e => set({steps:t.steps!.map((s,j) => j === i ? {...s,permission:e.target.checked ? 'plan' : undefined} : s)})} />Review only</label>
              <div className="step-fields">
                <input
                  className="text-input"
                  placeholder="Step title, e.g. Write tests"
                  value={step.title}
                  onChange={(e) => set({ steps: (t.steps ?? []).map((s, j) => (j === i ? { ...s, title: e.target.value } : s)) })}
                />
                <textarea
                  className="prompt-input"
                  rows={2}
                  placeholder="What Claude should do in this step"
                  value={step.prompt}
                  onChange={(e) => set({ steps: (t.steps ?? []).map((s, j) => (j === i ? { ...s, prompt: e.target.value } : s)) })}
                />
              </div>
              <IconButton icon={Trash2} label="Remove step" size={14} onClick={() => set({ steps: (t.steps ?? []).filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ol>
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => set({ steps: [...(t.steps ?? []), { title: '', prompt: '' }] })}>
          Add a step
        </Button>
      </div>

      <div className="schedule-box">
        <label className="check-row">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          <Repeat size={14} />
          <span>
            Repeat on a schedule
            <span className="field-hint block">Runs while Mission Control is open (it stays in the tray). If it was closed at the time, the task runs once when you next open it.</span>
          </span>
        </label>
        {recurring && (
          <div className="field-row schedule-row">
            <label className="field">
              <span className="field-label">When</span>
              <select className="select" value={schedule.kind} onChange={(e) => setSchedule({ ...schedule, kind: e.target.value as Schedule['kind'] })}>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays (Mon–Fri)</option>
                <option value="weekly">Once a week</option>
                <option value="hourly">Every few hours</option>
              </select>
            </label>
            {schedule.kind === 'weekly' && (
              <label className="field">
                <span className="field-label">Day</span>
                <select className="select" value={schedule.weekday ?? 1} onChange={(e) => setSchedule({ ...schedule, weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {schedule.kind === 'hourly' ? (
              <label className="field budget-field">
                <span className="field-label">Every (hours)</span>
                <input className="text-input" type="number" min={1} max={168} value={schedule.everyHours ?? 4} onChange={(e) => setSchedule({ ...schedule, everyHours: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
            ) : (
              <label className="field">
                <span className="field-label">Time</span>
                <input className="text-input" type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
              </label>
            )}
            <label className="field">
              <span className="field-label">Then</span>
              <select className="select" value={schedule.then} onChange={(e) => setSchedule({ ...schedule, then: e.target.value as Schedule['then'] })}>
                <option value="start">Start it right away</option>
                <option value="queue">Add it to the queue</option>
                <option value="todo">Just add it to To do</option>
              </select>
            </label>
          </div>
        )}
        {recurring && !t.projectPath && <span className="field-hint warn">A repeating template needs a project.</span>}
      </div>

      <div className="dialog-foot inline">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!t.prompt.trim() || (recurring && !t.projectPath)}>
          {id ? 'Save template' : 'Create template'}
        </Button>
      </div>
    </div>
  )
}

export default function TemplatesDialog({ templates, projects, onClose, onUse }: Props) {
  const toast = useToast()
  const [editing, setEditing] = useState<{ id?: string; initial: TemplateInput } | null>(null)

  const run = async (tpl: TaskTemplate, then: Schedule['then']) => {
    if (!tpl.projectPath) {
      onUse(tpl)
      return
    }
    try {
      const task = await window.mc.runTemplate(tpl.id, then)
      toast('success', then === 'start' ? 'Task started' : then === 'queue' ? 'Added to the queue' : 'Added to To do', task.title)
    } catch (e) {
      toast('error', 'Could not run the template', errorMessage(e))
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog templates" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && (editing ? setEditing(null) : onClose())}>
        <div className="dialog-head">
          <h2>{editing ? (editing.id ? 'Edit template' : 'New template') : 'Task templates'}</h2>
          <div className="toolbar">
            {!editing && (
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing({ initial: blank })}>
                New template
              </Button>
            )}
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
        </div>

        {editing ? (
          <TemplateEditor initial={editing.initial} id={editing.id} projects={projects} onDone={() => setEditing(null)} />
        ) : templates.length === 0 ? (
          <div className="dialog-body">
            <EmptyState icon={FileStack} title="No templates yet">
              Save tasks you run often, like a daily dependency check or a weekly test run, and start them with one click or on a schedule.
            </EmptyState>
          </div>
        ) : (
          <div className="dialog-body">
            <ul className="template-list">
              {templates.map((tpl) => {
                const s = tpl.schedule
                return (
                  <li key={tpl.id} className="template-row">
                    <Avatar name={tpl.projectName ?? tpl.name} path={tpl.projectPath} size={30} />
                    <div className="template-main">
                      <div className="strong ellipsis">{tpl.name}</div>
                      <div className="muted small template-sub">
                        <span>{tpl.projectName ?? 'Any project'}</span>
                        <span>· {tpl.mode === 'headless' ? 'Headless' : 'Interactive'}</span>
                        {!!tpl.steps?.length && <span>· {tpl.steps.length + 1}-step pipeline</span>}
                        {s && (
                          <span className={s.enabled ? 'tone-accent' : ''}>
                            · <CalendarClock size={11} /> {describeSchedule(s)}
                            {s.enabled && s.nextRunAt ? `, next ${inFuture(s.nextRunAt)}` : s.enabled ? '' : ' (paused)'}
                            {s.lastRunAt ? `, last ${timeAgo(s.lastRunAt)}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {s && (
                      <label className="switch" title={s.enabled ? 'Pause the schedule' : 'Resume the schedule'}>
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e) => window.mc.saveTemplate({ ...tpl, schedule: { ...s, enabled: e.target.checked } }, tpl.id)}
                        />
                        <span />
                      </label>
                    )}
                    <IconButton icon={Play} label={tpl.projectPath ? 'Start a task from it now' : 'Use (pick a project)'} size={15} onClick={() => run(tpl, 'start')} />
                    {tpl.mode === 'headless' && tpl.projectPath && <IconButton icon={ListPlus} label="Add a task from it to the queue" size={15} onClick={() => run(tpl, 'queue')} />}
                    <IconButton icon={Copy} label="Open in New task to adjust first" size={15} onClick={() => onUse(tpl)} />
                    <IconButton icon={Pencil} label="Edit" size={15} onClick={() => setEditing({ id: tpl.id, initial: tpl })} />
                    <IconButton
                      icon={Trash2}
                      label="Delete"
                      size={15}
                      onClick={() => window.confirm(`Delete the template "${tpl.name}"?`) && window.mc.deleteTemplate(tpl.id)}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
