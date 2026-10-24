import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { Check, Circle, Coins, Eye, FileText, GitBranch, Pause, Pencil, Plus, Workflow, X } from 'lucide-react'
import type { BudgetState, Project, ProjectMeta, ProjectStatus, UsageTotals } from '@shared/types'
import { formatCost, formatTokens } from '../util'
import { Button, Segmented } from './ui'
import SpendingCard from './SpendingCard'
import { PlanShare } from '../planRate'

interface Props {
  project: Project
  /** Group names already used by any project, offered as suggestions. */
  groups: string[]
  /** Per-session usage for this project (from the index). */
  usage: Record<string, UsageTotals>
  budget?: BudgetState
  isRepo: boolean
  onTurnOnGit: () => void
  onChanged: () => void
}

/** Whether compaction writes a proper handoff here, and a button to make it so. */
function BriefingField({ project }: { project: Project }) {
  const [has, setHas] = useState<boolean | null>(null)
  useEffect(() => {
    window.mc.hasSummaryInstructions(project.path).then(setHas).catch(() => setHas(null))
  }, [project.path])
  return (
    <div className="field">
      <span className="field-label">Session briefings</span>
      {has ? (
        <span className="small">
          <FileText size={12} /> CLAUDE.md asks for briefing-style summaries. Each one is saved to docs/briefings/ when a chat runs out of room.
        </span>
      ) : (
        <div className="inline-field">
          <span className="small muted">Briefings are saved to docs/briefings/. Add a few lines to CLAUDE.md so Claude writes them as a proper handoff (state, decisions, next steps, gotchas).</span>
          <Button
            size="sm"
            variant="secondary"
            icon={FileText}
            onClick={async () => {
              await window.mc.addSummaryInstructions(project.path)
              setHas(true)
            }}
          >
            Add to CLAUDE.md
          </Button>
        </div>
      )}
    </div>
  )
}

/** Check command, monthly budget and git status: the settings automation relies on. */
function AutomationCard({ project, budget, isRepo, onTurnOnGit, onChanged }: Pick<Props, 'project' | 'budget' | 'isRepo' | 'onTurnOnGit' | 'onChanged'>) {
  const [check, setCheck] = useState(project.meta.checkCommand ?? '')
  const [limit, setLimit] = useState(project.meta.monthlyBudgetUsd ? String(project.meta.monthlyBudgetUsd) : '')
  useEffect(() => {
    setCheck(project.meta.checkCommand ?? '')
    setLimit(project.meta.monthlyBudgetUsd ? String(project.meta.monthlyBudgetUsd) : '')
  }, [project.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<ProjectMeta>) => {
    await window.mc.setProjectMeta(project.path, patch)
    onChanged()
  }
  const pct = budget ? Math.round(budget.ratio * 100) : 0

  return (
    <section className="card overview-card automation-card">
      <h3>
        <Workflow size={15} /> Automation
      </h3>
      <div className="field">
        <span className="field-label">Git</span>
        {isRepo ? (
          <span className="small">
            <GitBranch size={12} /> On. Tasks can use worktrees, and you can review and merge their changes.
          </span>
        ) : (
          <div className="inline-field">
            <span className="small muted">Off. Worktrees, Review and Merge need git.</span>
            <Button size="sm" variant="secondary" icon={GitBranch} onClick={onTurnOnGit}>
              Turn on git
            </Button>
          </div>
        )}
      </div>
      <BriefingField project={project} />
      <label className="field">
        <span className="field-label">Check command</span>
        <input
          className="text-input mono"
          placeholder="e.g. npm test   or   pytest -q"
          value={check}
          onChange={(e) => setCheck(e.target.value)}
          onBlur={() => check.trim() !== (project.meta.checkCommand ?? '') && save({ checkCommand: check.trim() || undefined })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="field-hint">Runs in PowerShell, in the task’s folder, after every headless task. Exit code 0 means passed. Tasks waiting on it only start if it passes.</span>
      </label>
      <label className="field">
        <span className="field-label">Monthly budget (USD, estimated at API prices)</span>
        <input
          className="text-input num-wide"
          type="number"
          min={0}
          step={5}
          placeholder="No budget"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          onBlur={() => {
            const n = Number(limit)
            const next = n > 0 ? n : undefined
            if (next !== project.meta.monthlyBudgetUsd) save({ monthlyBudgetUsd: next })
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {budget ? (
          <div className="budget-meter">
            <span className="meter-track" aria-hidden>
              <span className={`meter-fill ${budget.over ? 'over' : pct >= 80 ? 'warn' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className={`small ${budget.over ? 'tone-red' : ''}`}>
              {formatCost(budget.spent)} of {formatCost(budget.budget)} this month ({pct}%)
            </span>
          </div>
        ) : null}
        <span className="field-hint">
          You get a warning at 80%. Over budget, the queue, recurring tasks and chains hold for this project; you can still start tasks yourself.
        </span>
      </label>
    </section>
  )
}

export default function OverviewPanel({ project, groups, usage, budget, isRepo, onTurnOnGit, onChanged }: Props) {
  const [meta, setMeta] = useState<ProjectMeta>(project.meta)
  const [tagDraft, setTagDraft] = useState('')
  const [editingNotes, setEditingNotes] = useState(!project.meta.notes)
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setMeta(project.meta), [project.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<ProjectMeta>) => {
    setMeta((m) => ({ ...m, ...patch }))
    await window.mc.setProjectMeta(project.path, patch)
    onChanged()
  }

  // Notes save themselves shortly after you stop typing.
  const onNotes = (notes: string) => {
    setMeta((m) => ({ ...m, notes }))
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await window.mc.setProjectMeta(project.path, { notes })
      setSaved(true)
    }, 600)
  }
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '')
    setTagDraft('')
    if (t && !meta.tags.includes(t)) save({ tags: [...meta.tags, t] })
  }

  const totals = Object.values(usage).reduce(
    (t, u) => ({ input: t.input + u.input, output: t.output + u.output, cacheWrite: t.cacheWrite + u.cacheWrite, cacheRead: t.cacheRead + u.cacheRead, cost: t.cost + u.cost }),
    { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 }
  )
  const allTokens = totals.input + totals.output + totals.cacheWrite + totals.cacheRead

  return (
    <div className="overview scroll">
      <div className="overview-grid">
        <section className="card overview-card">
          <h3>Organize</h3>
          <label className="field">
            <span className="field-label">Status</span>
            <Segmented<ProjectStatus | 'none'>
              value={meta.status ?? 'none'}
              onChange={(v) => save({ status: v === 'none' ? undefined : v })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'active', label: 'Active', icon: Circle },
                { value: 'paused', label: 'Paused', icon: Pause },
                { value: 'done', label: 'Done', icon: Check }
              ]}
            />
          </label>
          <label className="field">
            <span className="field-label">Group</span>
            <input
              className="text-input"
              list="mc-groups"
              placeholder="e.g. Work, Trading, Games"
              value={meta.group ?? ''}
              onChange={(e) => setMeta((m) => ({ ...m, group: e.target.value }))}
              onBlur={(e) => e.target.value !== (project.meta.group ?? '') && save({ group: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <datalist id="mc-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <span className="field-hint">Projects with the same group share a section in the sidebar.</span>
          </label>
          <div className="field">
            <span className="field-label">Tags</span>
            <div className="tag-editor">
              {meta.tags.map((t) => (
                <span key={t} className="tag on">
                  #{t}
                  <button onClick={() => save({ tags: meta.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <span className="tag-add">
                <Plus size={12} />
                <input
                  placeholder="Add tag"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                  onBlur={addTag}
                />
              </span>
            </div>
          </div>
        </section>

        <section className="card overview-card">
          <h3>
            <Coins size={15} /> Usage
          </h3>
          {Object.keys(usage).length === 0 ? (
            <p className="muted">No token usage recorded for this project yet.</p>
          ) : (
            <>
              <div className="usage-hero">
                <div>
                  <div className="hero-value">{formatCost(totals.cost)}</div>
                  <div className="muted small">
                    estimated at API prices
                    <PlanShare usd={totals.cost} prefix=" · " long />
                  </div>
                </div>
                <div>
                  <div className="hero-value">{formatTokens(allTokens)}</div>
                  <div className="muted small">tokens in {Object.keys(usage).length} chats</div>
                </div>
              </div>
              <dl className="usage-split">
                <dt>Output</dt>
                <dd>{formatTokens(totals.output)}</dd>
                <dt>Input</dt>
                <dd>{formatTokens(totals.input)}</dd>
                <dt>Cache writes</dt>
                <dd>{formatTokens(totals.cacheWrite)}</dd>
                <dt>Cache reads</dt>
                <dd>{formatTokens(totals.cacheRead)}</dd>
              </dl>
            </>
          )}
        </section>
      </div>

      <AutomationCard project={project} budget={budget} isRepo={isRepo} onTurnOnGit={onTurnOnGit} onChanged={onChanged} />
      <SpendingCard project={project} onChanged={onChanged} />

      <section className="card overview-card notes-card">
        <h3>
          Notes
          <span className="notes-state muted small">{editingNotes ? (saved ? 'Saved' : 'Saving…') : ''}</span>
          <button className="btn btn-ghost btn-sm notes-toggle" onClick={() => setEditingNotes((e) => !e)}>
            {editingNotes ? <Eye size={13} /> : <Pencil size={13} />}
            <span>{editingNotes ? 'Preview' : 'Edit'}</span>
          </button>
        </h3>
        {editingNotes ? (
          <textarea
            className="notes-editor"
            placeholder="Goals, next steps, links, things to remember… (Markdown)"
            value={meta.notes}
            onChange={(e) => onNotes(e.target.value)}
            spellCheck
          />
        ) : (
          <div className="markdown notes-view" onDoubleClick={() => setEditingNotes(true)}>
            <Markdown>{meta.notes}</Markdown>
          </div>
        )}
      </section>
    </div>
  )
}
