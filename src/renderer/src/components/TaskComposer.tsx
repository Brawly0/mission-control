import { useEffect, useRef, useState } from 'react'
import { FileStack, GitFork, Link2, ListPlus, Play, Plus, ShieldAlert, SquareTerminal, X, Zap } from 'lucide-react'
import type { GitInfo, NewTask, Project, Task, TaskMode, TaskPermission } from '@shared/types'
import { Button, IconButton, Segmented } from './ui'

interface Props {
  projects: Project[]
  git: Record<string, GitInfo>
  defaultProject?: string
  /** Prefill, e.g. from a template. */
  initial?: Partial<NewTask>
  /** Existing tasks this one can wait on. */
  tasks: Task[]
  onCancel: () => void
  onCreate: (task: NewTask, then: 'todo' | 'queue' | 'start') => void
  onSaveTemplate: (task: NewTask) => void
}

const PERMISSIONS: { value: TaskPermission; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto (recommended)', hint: 'A safety check approves routine actions and blocks risky ones.' },
  { value: 'acceptEdits', label: 'Accept edits', hint: 'File edits are allowed; other actions that need approval are refused.' },
  { value: 'plan', label: 'Plan only', hint: 'Read-only: Claude investigates and writes a plan, changes nothing.' },
  { value: 'bypassPermissions', label: 'Bypass all checks', hint: 'Everything is allowed without asking. Only use in a worktree you can discard.' }
]

export default function TaskComposer({ projects, git, defaultProject, initial, tasks, onCancel, onCreate, onSaveTemplate }: Props) {
  const [dependsOn, setDependsOn] = useState<string[]>(initial?.dependsOn ?? [])
  const [whenReady, setWhenReady] = useState<NonNullable<Task['whenReady']>>(initial?.whenReady ?? 'start')
  const choices = projects.filter((p) => !p.worktree)
  const startProject = initial?.projectPath ?? defaultProject
  const [projectPath, setProjectPath] = useState(startProject && choices.some((p) => p.path === startProject) ? startProject : (choices[0]?.path ?? ''))
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [mode, setMode] = useState<TaskMode>(initial?.mode ?? 'headless')
  const [permission, setPermission] = useState<TaskPermission>(initial?.permission ?? 'auto')
  const isRepo = !!git[projectPath]?.isRepo
  const [useWorktree, setUseWorktree] = useState(initial?.useWorktree ?? isRepo)
  const [budget, setBudget] = useState(initial?.budgetUsd ? String(initial.budgetUsd) : '')
  const [model, setModel] = useState(initial?.model ?? '')
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => promptRef.current?.focus(), [])
  const firstRepoCheck = useRef(true)
  useEffect(() => {
    // Default to a worktree in git projects, but keep a template's own choice on first open.
    if (firstRepoCheck.current && initial?.useWorktree !== undefined) {
      firstRepoCheck.current = false
      return
    }
    firstRepoCheck.current = false
    setUseWorktree(isRepo)
  }, [isRepo]) // eslint-disable-line react-hooks/exhaustive-deps

  const project = choices.find((p) => p.path === projectPath)
  const valid = !!project && prompt.trim().length > 0
  const current = (): NewTask | null => {
    if (!valid || !project) return null
    const budgetUsd = Number(budget)
    return {
      title: title.trim(),
      prompt: prompt.trim(),
      projectPath: project.path,
      projectName: project.name,
      mode,
      permission,
      useWorktree: isRepo && useWorktree,
      budgetUsd: mode === 'headless' && budgetUsd > 0 ? budgetUsd : undefined,
      model: model || undefined,
      templateId: initial?.templateId,
      dependsOn: dependsOn.length ? dependsOn : undefined,
      whenReady: dependsOn.length ? whenReady : undefined
    }
  }
  // Tasks worth waiting on: not finished yet, or finished and waiting for review. Same project first.
  const candidates = tasks
    .filter((t) => t.column !== 'done' && !dependsOn.includes(t.id))
    .sort((a, b) => Number(b.projectPath === projectPath) - Number(a.projectPath === projectPath) || b.createdAt - a.createdAt)
  const submit = (then: 'todo' | 'queue' | 'start') => {
    const t = current()
    if (t) onCreate(t, then)
  }

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <form
        className="dialog composer"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit('todo')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && e.ctrlKey) submit('start')
        }}
      >
        <div className="dialog-head">
          <h2>{initial?.templateId ? 'New task from template' : 'New task'}</h2>
          <IconButton icon={X} label="Close" onClick={onCancel} type="button" />
        </div>

        <div className="dialog-body">
          <label className="field">
            <span className="field-label">What should Claude do?</span>
            <textarea
              ref={promptRef}
              className="prompt-input"
              placeholder="e.g. Add input validation to the signup form and write tests for it."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
            />
          </label>
          <div className="field-row">
            <label className="field grow">
              <span className="field-label">Title (optional)</span>
              <input className="text-input" placeholder="Defaults to the first line of the prompt" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Project</span>
              <select className="select" value={projectPath} onChange={(e) => setProjectPath(e.target.value)}>
                {choices.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field">
            <span className="field-label">How to run it</span>
            <Segmented<TaskMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'headless', label: 'Headless', icon: Zap },
                { value: 'interactive', label: 'Interactive', icon: SquareTerminal }
              ]}
            />
            <span className="field-hint">
              {mode === 'headless'
                ? 'Runs in the background without a terminal. Progress shows on the card; you review the result.'
                : 'Opens an agent terminal with this prompt, so you can follow along and answer questions.'}
            </span>
          </div>

          <div className="field-row">
            <label className="field grow">
              <span className="field-label">Permissions</span>
              <select className="select" value={permission} onChange={(e) => setPermission(e.target.value as TaskPermission)}>
                {PERMISSIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span className={`field-hint ${permission === 'bypassPermissions' ? 'warn' : ''}`}>
                {permission === 'bypassPermissions' && <ShieldAlert size={12} />} {PERMISSIONS.find((p) => p.value === permission)?.hint}
              </span>
            </label>
            <label className="field">
              <span className="field-label">Model</span>
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Default</option>
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            </label>
            {mode === 'headless' && (
              <label className="field budget-field">
                <span className="field-label">Budget (USD)</span>
                <input className="text-input" type="number" min="0" step="0.5" placeholder="No limit" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </label>
            )}
          </div>

          <div className="field">
            <span className="field-label">
              <Link2 size={12} /> Run after (optional)
            </span>
            <div className="dep-picker">
              {dependsOn.map((id) => {
                const t = tasks.find((x) => x.id === id)
                return (
                  <span key={id} className="tag on">
                    {t?.title ?? 'Deleted task'}
                    <button type="button" onClick={() => setDependsOn((d) => d.filter((x) => x !== id))} aria-label="Remove">
                      <X size={11} />
                    </button>
                  </span>
                )
              })}
              {candidates.length > 0 && (
                <select
                  className="select select-sm"
                  value=""
                  onChange={(e) => e.target.value && setDependsOn((d) => [...d, e.target.value])}
                  aria-label="Add a task to wait for"
                >
                  <option value="">{dependsOn.length ? 'And after…' : 'Pick a task to wait for…'}</option>
                  {candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({t.projectName}, {t.column === 'todo' ? 'to do' : t.column})
                    </option>
                  ))}
                </select>
              )}
              {candidates.length === 0 && dependsOn.length === 0 && <span className="muted small">No other open tasks.</span>}
            </div>
            {dependsOn.length > 0 && (
              <div className="inline-field small">
                When they’ve all succeeded:
                <select className="select select-sm" value={whenReady} onChange={(e) => setWhenReady(e.target.value as NonNullable<Task['whenReady']>)}>
                  <option value="start">start this task</option>
                  <option value="queue">add it to the queue</option>
                  <option value="none">just mark it ready</option>
                </select>
                <span className="field-hint">
                  If one fails, this one waits; you can retry it or run this anyway. In worktrees it builds on the previous task’s branch.
                </span>
              </div>
            )}
          </div>

          <label className={`check-row ${isRepo ? '' : 'disabled'}`}>
            <input type="checkbox" checked={isRepo && useWorktree} disabled={!isRepo} onChange={(e) => setUseWorktree(e.target.checked)} />
            <GitFork size={14} />
            <span>
              Run in its own worktree
              <span className="field-hint block">
                {isRepo ? 'A separate branch, so it can’t clash with other agents. Review and merge it when it’s done.' : 'Needs a git repository.'}
              </span>
            </span>
          </label>
        </div>

        <div className="dialog-foot">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={FileStack}
            disabled={!valid}
            title="Keep these settings as a reusable template"
            onClick={() => {
              const t = current()
              if (t) onSaveTemplate(t)
            }}
          >
            Save as template
          </Button>
          <span className="spacer" />
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="secondary" icon={Plus} disabled={!valid}>
            Add to To do
          </Button>
          {mode === 'headless' && (
            <Button type="button" variant="secondary" icon={ListPlus} disabled={!valid} onClick={() => submit('queue')} title="Runs by itself when the queue has a free slot">
              Add to queue
            </Button>
          )}
          <Button type="button" variant="primary" icon={Play} disabled={!valid} onClick={() => submit('start')} title="Ctrl+Enter">
            Add and start
          </Button>
        </div>
      </form>
    </div>
  )
}
