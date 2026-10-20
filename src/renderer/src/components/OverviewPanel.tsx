import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { Check, Circle, Coins, Eye, Pause, Pencil, Plus, X } from 'lucide-react'
import type { Project, ProjectMeta, ProjectStatus, UsageTotals } from '@shared/types'
import { formatCost, formatTokens } from '../util'
import { Segmented } from './ui'

interface Props {
  project: Project
  /** Group names already used by any project, offered as suggestions. */
  groups: string[]
  /** Per-session usage for this project (from the index). */
  usage: Record<string, UsageTotals>
  onChanged: () => void
}

export default function OverviewPanel({ project, groups, usage, onChanged }: Props) {
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
                  <div className="muted small">estimated at API prices</div>
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
