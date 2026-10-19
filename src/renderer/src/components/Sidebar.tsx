import { useMemo, useState } from 'react'
import { Bot, FolderPlus, GitBranch, House, RefreshCw, Search, Star } from 'lucide-react'
import type { GitInfo, Project } from '@shared/types'
import type { Agent, View } from '../types'
import { timeAgo } from '../util'
import { Avatar, IconButton, Kbd } from './ui'

interface Props {
  projects: Project[]
  git: Record<string, GitInfo>
  loading: boolean
  selectedPath: string | null
  view: View
  agents: Agent[]
  showWorktrees: boolean
  onToggleWorktrees: (v: boolean) => void
  onSelect: (path: string) => void
  onNavigate: (view: View) => void
  onOpenPalette: () => void
  onRefresh: () => void
  onAdd: () => void
}

export default function Sidebar(props: Props) {
  const { projects, git, loading, selectedPath, view, agents, showWorktrees } = props
  const [filter, setFilter] = useState('')

  const runningByProject = useMemo(() => {
    const counts = new Map<string, { running: number; attention: number }>()
    for (const a of agents) {
      if (a.exited) continue
      const key = a.projectPath.toLowerCase()
      const c = counts.get(key) ?? { running: 0, attention: 0 }
      c.running++
      if (a.hookStatus === 'needs-input') c.attention++
      counts.set(key, c)
    }
    return counts
  }, [agents])

  const live = agents.filter((a) => !a.exited)
  const attention = live.filter((a) => a.hookStatus === 'needs-input').length

  const q = filter.trim().toLowerCase()
  const visible = projects.filter(
    (p) => (showWorktrees || !p.worktree) && (!q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
  )
  const pinned = visible.filter((p) => p.pinned)
  const rest = visible.filter((p) => !p.pinned)
  const hiddenCount = projects.filter((p) => p.worktree).length

  const renderItem = (p: Project) => {
    const counts = runningByProject.get(p.path.toLowerCase())
    const g = git[p.path]
    const selected = view === 'project' && p.path === selectedPath
    return (
      <li key={p.path}>
        <button className={`project-item ${selected ? 'selected' : ''}`} onClick={() => props.onSelect(p.path)} title={p.path}>
          <Avatar name={p.name} size={30} />
          <div className="project-item-text">
            <div className="project-name">{p.name}</div>
            <div className="project-meta">
              {g?.isRepo ? (
                <span className="meta-branch">
                  <GitBranch size={11} strokeWidth={2.2} />
                  {g.branch}
                  {!!g.dirty && <span className="dirty-dot" title={`${g.dirty} changed files`} />}
                </span>
              ) : (
                <span>
                  {p.sessionCount} {p.sessionCount === 1 ? 'chat' : 'chats'}
                </span>
              )}
              <span className="meta-sep">·</span>
              <span>{p.lastActivity ? timeAgo(p.lastActivity) : 'no chats'}</span>
            </div>
          </div>
          <div className="project-item-end">
            {counts ? (
              <span className={`run-pill ${counts.attention ? 'attention' : ''}`} title={`${counts.running} running`}>
                <span className={`dot ${counts.attention ? 'needs-input' : 'working'}`} />
                {counts.running}
              </span>
            ) : (
              p.pinned && <Star size={12} className="pin-star" fill="currentColor" />
            )}
          </div>
        </button>
      </li>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z" fill="currentColor" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">Mission Control</div>
          <div className="brand-sub">for Claude Code</div>
        </div>
      </div>

      <button className="search-trigger" onClick={props.onOpenPalette}>
        <Search size={14} />
        <span>Search or jump to…</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <nav className="nav">
        <button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => props.onNavigate('home')}>
          <House size={16} strokeWidth={1.9} />
          <span>Home</span>
        </button>
        <button className={`nav-item ${view === 'agents' ? 'active' : ''}`} onClick={() => props.onNavigate('agents')}>
          <Bot size={16} strokeWidth={1.9} />
          <span>Agents</span>
          <span className="nav-end">
            {attention > 0 && <span className="count count-attention">{attention}</span>}
            {live.length > 0 && <span className="count">{live.length}</span>}
          </span>
        </button>
      </nav>

      <div className="section-head">
        <span>Projects</span>
        <div className="section-actions">
          <IconButton icon={RefreshCw} label="Refresh" size={14} onClick={props.onRefresh} className={loading ? 'spinning' : ''} />
          <IconButton icon={FolderPlus} label="Add a project folder" size={14} onClick={props.onAdd} />
        </div>
      </div>
      <input className="filter" placeholder="Filter projects" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <div className="project-list">
        {loading && projects.length === 0 && <div className="muted pad">Scanning ~/.claude…</div>}
        {pinned.length > 0 && (
          <>
            <div className="group-label">Pinned</div>
            <ul>{pinned.map(renderItem)}</ul>
            <div className="group-label">All</div>
          </>
        )}
        <ul>{rest.map(renderItem)}</ul>
        {!loading && visible.length === 0 && <div className="muted pad">No projects match.</div>}
      </div>

      {hiddenCount > 0 && (
        <label className="sidebar-footer">
          <input type="checkbox" checked={showWorktrees} onChange={(e) => props.onToggleWorktrees(e.target.checked)} />
          Show worktrees &amp; scratch ({hiddenCount})
        </label>
      )}
    </aside>
  )
}
