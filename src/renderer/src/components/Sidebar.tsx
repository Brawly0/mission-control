import { useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import type { Agent } from '../types'
import { timeAgo } from '../util'

interface Props {
  projects: Project[]
  loading: boolean
  selectedPath: string | null
  agents: Agent[]
  onSelect: (path: string) => void
  onRefresh: () => void
  onAdd: () => void
}

export default function Sidebar({ projects, loading, selectedPath, agents, onSelect, onRefresh, onAdd }: Props) {
  const [filter, setFilter] = useState('')
  const [showWorktrees, setShowWorktrees] = useState(false)

  const runningByPath = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of agents) {
      if (a.exited) continue
      const key = a.cwd.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [agents])

  const q = filter.trim().toLowerCase()
  const visible = projects.filter(
    (p) =>
      (showWorktrees || !p.worktree) &&
      (!q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
  )
  const pinned = visible.filter((p) => p.pinned)
  const rest = visible.filter((p) => !p.pinned)
  const worktreeCount = projects.filter((p) => p.worktree).length

  const renderItem = (p: Project) => {
    const running = runningByPath.get(p.path.toLowerCase()) ?? 0
    return (
      <li key={p.path}>
        <button
          className={`project-item ${p.path === selectedPath ? 'selected' : ''}`}
          onClick={() => onSelect(p.path)}
          title={p.path}
        >
          <div className="project-item-row">
            <span className="project-name">
              {p.pinned && <span className="pin">★</span>}
              {p.name}
            </span>
            {running > 0 && <span className="dot running" title={`${running} running`} />}
          </div>
          <div className="project-meta">
            {p.sessionCount} {p.sessionCount === 1 ? 'chat' : 'chats'} · {timeAgo(p.lastActivity)}
            {p.worktree && ' · worktree'}
          </div>
        </button>
      </li>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-mark">◆</span> Mission Control
        </div>
        <div className="sidebar-actions">
          <button className="icon-btn" onClick={onRefresh} title="Refresh">
            ↻
          </button>
          <button className="icon-btn" onClick={onAdd} title="Add a project folder">
            ＋
          </button>
        </div>
      </div>
      <input
        className="search"
        placeholder="Filter projects…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="project-list">
        {loading && projects.length === 0 && <div className="muted pad">Scanning ~/.claude…</div>}
        {pinned.length > 0 && (
          <>
            <div className="section-label">Pinned</div>
            <ul>{pinned.map(renderItem)}</ul>
          </>
        )}
        <div className="section-label">Projects</div>
        <ul>{rest.map(renderItem)}</ul>
      </div>
      {worktreeCount > 0 && (
        <label className="sidebar-footer">
          <input type="checkbox" checked={showWorktrees} onChange={(e) => setShowWorktrees(e.target.checked)} />
          Show worktrees &amp; scratch ({worktreeCount})
        </label>
      )}
    </aside>
  )
}
