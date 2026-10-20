import { useEffect, useRef, useState } from 'react'
import { GitFork, Play, Plus, ShieldAlert, SquareTerminal, X, Zap } from 'lucide-react'
import type { GitInfo, NewTask, Project, TaskMode, TaskPermission } from '@shared/types'
import { Button, IconButton, Segmented } from './ui'

interface Props {
  projects: Project[]
  git: Record<string, GitInfo>
  defaultProject?: string
  onCancel: () => void
  onCreate: (task: NewTask, startNow: boolean) => void
}

const PERMISSIONS: { value: TaskPermission; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto (recommended)', hint: 'A safety check approves routine actions and blocks risky ones.' },
  { value: 'acceptEdits', label: 'Accept edits', hint: 'File edits are allowed; other actions that need approval are refused.' },
  { value: 'plan', label: 'Plan only', hint: 'Read-only: Claude investigates and writes a plan, changes nothing.' },
  { value: 'bypassPermissions', label: 'Bypass all checks', hint: 'Everything is allowed without asking. Only use in a worktree you can discard.' }
]

export default function TaskComposer({ projects, git, defaultProject, onCancel, onCreate }: Props) {
  const choices = projects.filter((p) => !p.worktree)
  const [projectPath, setProjectPath] = useState(defaultProject && choices.some((p) => p.path === defaultProject) ? defaultProject : (choices[0]?.path ?? ''))
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<TaskMode>('headless')
  const [permission, setPermission] = useState<TaskPermission>('auto')
  const isRepo = !!git[projectPath]?.isRepo
  const [useWorktree, setUseWorktree] = useState(isRepo)
  const [budget, setBudget] = useState('')
  const [model, setModel] = useState('')
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => promptRef.current?.focus(), [])
  useEffect(() => setUseWorktree(isRepo), [isRepo])

  const project = choices.find((p) => p.path === projectPath)
  const valid = !!project && prompt.trim().length > 0
  const submit = (startNow: boolean) => {
    if (!valid || !project) return
    const budgetUsd = Number(budget)
    onCreate(
      {
        title: title.trim(),
        prompt: prompt.trim(),
        projectPath: project.path,
        projectName: project.name,
        mode,
        permission,
        useWorktree: isRepo && useWorktree,
        budgetUsd: mode === 'headless' && budgetUsd > 0 ? budgetUsd : undefined,
        model: model || undefined
      },
      startNow
    )
  }

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <form
        className="dialog composer"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && e.ctrlKey) submit(true)
        }}
      >
        <div className="dialog-head">
          <h2>New task</h2>
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
          <span className="muted small">Ctrl+Enter adds and starts</span>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="secondary" icon={Plus} disabled={!valid}>
            Add to To do
          </Button>
          <Button type="button" variant="primary" icon={Play} disabled={!valid} onClick={() => submit(true)}>
            Add and start
          </Button>
        </div>
      </form>
    </div>
  )
}
