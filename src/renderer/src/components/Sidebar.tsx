import { useMemo, useState } from 'react'
import { BarChart3, Bot, Check, ChevronRight, FolderPlus, GitBranch, House, KanbanSquare, PanelLeftClose, PanelLeftOpen, Pause, RefreshCw, Search, Star, TextSearch } from 'lucide-react'
import type { BudgetState, GitInfo, Project } from '@shared/types'
import type { Agent, View } from '../types'
import { timeAgo } from '../util'
import { Avatar, IconButton, Kbd } from './ui'
import { useKeyFor, withKey } from '../shortcuts'

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
  taskCounts: { running: number; review: number }
  /** Monthly budget state, keyed by lower-cased project path. */
  budgets: Record<string, BudgetState>
  /** Icon-only rail instead of the full sidebar. */
  collapsed: boolean
  onToggleCollapsed: () => void
}

/**
 * Projects in the order the sidebar shows them: pinned, then groups by name, then the rest,
 * finished ones last in each section. Alt+Up/Down follow the same order.
 */
export function sidebarOrder(projects: Project[], showWorktrees: boolean): Project[] {
  const visible = projects.filter((p) => showWorktrees || !p.worktree)
  const ordered = [...visible].sort((a, b) => Number(a.meta.status === 'done') - Number(b.meta.status === 'done'))
  const groupNames = [...new Set(ordered.filter((p) => !p.pinned).map((p) => p.meta.group || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b))
  return [
    ...ordered.filter((p) => p.pinned),
    ...groupNames.flatMap((g) => ordered.filter((p) => !p.pinned && p.meta.group === g)),
    ...ordered.filter((p) => !p.pinned && !p.meta.group)
  ]
}

/** Shows a combination like "Ctrl+Shift+F" as compact key caps text. */
function keyCaps(combo: string): string {
  return combo.replace(/\+/g, ' ').replace('Shift', '⇧')
}

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('mc.collapsedGroups') ?? '[]'))
  } catch {
    return new Set()
  }
}

export default function Sidebar(props: Props) {
  const { projects, git, loading, selectedPath, view, agents, showWorktrees } = props
  const [filter, setFilter] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const keyFor = useKeyFor()

  const toggleGroup = (name: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      try {
        localStorage.setItem('mc.collapsedGroups', JSON.stringify([...next]))
      } catch {
        /* just won't persist */
      }
      return next
    })
  }

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

  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.meta.tags))].sort((a, b) => a.localeCompare(b)), [projects])

  const q = filter.trim().toLowerCase()
  const visible = projects.filter(
    (p) =>
      (showWorktrees || !p.worktree) &&
      (!q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.meta.tags.some((t) => t.toLowerCase().includes(q))) &&
      activeTags.every((t) => p.meta.tags.includes(t))
  )
  // Finished projects sink to the bottom of their section.
  const ordered = [...visible].sort((a, b) => Number(a.meta.status === 'done') - Number(b.meta.status === 'done'))
  const pinned = ordered.filter((p) => p.pinned)
  const groups = new Map<string, Project[]>()
  for (const p of ordered.filter((x) => !x.pinned)) {
    const g = p.meta.group || ''
    groups.set(g, [...(groups.get(g) ?? []), p])
  }
  const groupNames = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b))
  const ungrouped = groups.get('') ?? []
  const hiddenCount = projects.filter((p) => p.worktree).length

  const renderItem = (p: Project) => {
    const counts = runningByProject.get(p.path.toLowerCase())
    const g = git[p.path]
    const selected = view === 'project' && p.path === selectedPath
    return (
      <li key={p.path}>
        <button
          className={`project-item ${selected ? 'selected' : ''} ${p.meta.status === 'done' ? 'is-done' : ''}`}
          onClick={() => props.onSelect(p.path)}
          title={[p.name, p.description, p.path].filter(Boolean).join('\n')}
        >
          <Avatar name={p.name} path={p.path} size={30} />
          <div className="project-item-text">
            <div className="project-name">
              <span className="ellipsis">{p.name}</span>
              {p.meta.status === 'paused' && <Pause size={11} className="status-icon paused" aria-label="Paused" />}
              {p.meta.status === 'done' && <Check size={12} className="status-icon done" aria-label="Done" />}
              {(() => {
                const b = props.budgets[p.path.toLowerCase().replace(/[\\/]+$/, '')]
                if (!b || b.ratio < 0.8) return null
                return (
                  <span className={`budget-flag ${b.over ? 'over' : ''}`} title={`About $${b.spent.toFixed(2)} of $${b.budget} this month${b.over ? ': automation is on hold' : ''}`}>
                    $
                  </span>
                )
              })()}
            </div>
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

  const renderGroup = (name: string, items: Project[]) => {
    const isCollapsed = collapsed.has(name)
    return (
      <div key={name} className="group">
        <button className="group-label group-toggle" onClick={() => toggleGroup(name)} aria-expanded={!isCollapsed}>
          <ChevronRight size={12} className={isCollapsed ? '' : 'rot90'} />
          <span>{name}</span>
          <span className="group-count">{items.length}</span>
        </button>
        {!isCollapsed && <ul>{items.map(renderItem)}</ul>}
      </div>
    )
  }

  const navItems = [
    { view: 'home' as View, icon: House, label: 'Home', shortcut: 'goHome' },
    { view: 'agents' as View, icon: Bot, label: 'Agents', shortcut: 'goAgents' },
    { view: 'tasks' as View, icon: KanbanSquare, label: 'Tasks', shortcut: 'goTasks' },
    { view: 'search' as View, icon: TextSearch, label: 'Search chats', shortcut: 'goSearch' },
    { view: 'usage' as View, icon: BarChart3, label: 'Usage', shortcut: 'goUsage' }
  ]

  if (props.collapsed) {
    return (
      <aside className="sidebar rail">
        <button className="brand-mark rail-brand" title={withKey('Show sidebar', keyFor('toggleSidebar'))} onClick={props.onToggleCollapsed}>
          <PanelLeftOpen size={17} />
        </button>
        <button className="rail-item" title={withKey('Command palette', keyFor('palette'))} onClick={props.onOpenPalette}>
          <Search size={17} />
        </button>
        <nav className="rail-nav">
          {navItems.map((n) => (
            <button key={n.view} className={`rail-item ${view === n.view ? 'active' : ''}`} title={withKey(n.label, keyFor(n.shortcut))} onClick={() => props.onNavigate(n.view)}>
              <n.icon size={17} strokeWidth={1.9} />
              {n.view === 'agents' && live.length > 0 && <span className={`rail-dot ${attention ? 'attention' : ''}`} />}
              {n.view === 'tasks' && props.taskCounts.review > 0 && <span className="rail-dot review" />}
            </button>
          ))}
        </nav>
        <div className="rail-projects">
          {sidebarOrder(projects, showWorktrees).map((p) => (
            <button
              key={p.path}
              className={`rail-project ${view === 'project' && p.path === selectedPath ? 'active' : ''}`}
              title={[p.name, p.description].filter(Boolean).join(' · ')}
              onClick={() => props.onSelect(p.path)}
            >
              <Avatar name={p.name} path={p.path} size={30} />
              {runningByProject.get(p.path.toLowerCase()) && <span className="rail-dot working" />}
            </button>
          ))}
        </div>
      </aside>
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
        <IconButton icon={PanelLeftClose} label={withKey('Hide sidebar', keyFor('toggleSidebar'))} size={15} className="brand-collapse" onClick={props.onToggleCollapsed} />
      </div>

      <button className="search-trigger" onClick={props.onOpenPalette}>
        <Search size={14} />
        <span>Jump to…</span>
        {keyFor('palette') && <Kbd>{keyCaps(keyFor('palette'))}</Kbd>}
      </button>

      <nav className="nav">
        <button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => props.onNavigate('home')} title={withKey('Home', keyFor('goHome'))}>
          <House size={16} strokeWidth={1.9} />
          <span>Home</span>
          <span className="nav-end nav-kbd">{keyCaps(keyFor('goHome'))}</span>
        </button>
        <button className={`nav-item ${view === 'agents' ? 'active' : ''}`} onClick={() => props.onNavigate('agents')} title={withKey('Agents', keyFor('goAgents'))}>
          <Bot size={16} strokeWidth={1.9} />
          <span>Agents</span>
          <span className="nav-end">
            {attention > 0 && <span className="count count-attention">{attention}</span>}
            {live.length > 0 && <span className="count">{live.length}</span>}
          </span>
        </button>
        <button className={`nav-item ${view === 'tasks' ? 'active' : ''}`} onClick={() => props.onNavigate('tasks')} title={withKey('Tasks', keyFor('goTasks'))}>
          <KanbanSquare size={16} strokeWidth={1.9} />
          <span>Tasks</span>
          <span className="nav-end">
            {props.taskCounts.review > 0 && (
              <span className="count count-review" title="Waiting for your review">
                {props.taskCounts.review}
              </span>
            )}
            {props.taskCounts.running > 0 && (
              <span className="count" title="Running">
                {props.taskCounts.running}
              </span>
            )}
          </span>
        </button>
        <button className={`nav-item ${view === 'search' ? 'active' : ''}`} onClick={() => props.onNavigate('search')} title={withKey('Search chats', keyFor('goSearch'))}>
          <TextSearch size={16} strokeWidth={1.9} />
          <span>Search chats</span>
          <span className="nav-end nav-kbd">{keyCaps(keyFor('goSearch'))}</span>
        </button>
        <button className={`nav-item ${view === 'usage' ? 'active' : ''}`} onClick={() => props.onNavigate('usage')} title={withKey('Usage', keyFor('goUsage'))}>
          <BarChart3 size={16} strokeWidth={1.9} />
          <span>Usage</span>
          <span className="nav-end nav-kbd">{keyCaps(keyFor('goUsage'))}</span>
        </button>
      </nav>

      <div className="section-head">
        <span>Projects</span>
        <div className="section-actions">
          <IconButton icon={RefreshCw} label={withKey('Refresh', keyFor('refresh'))} size={14} onClick={props.onRefresh} className={loading ? 'spinning' : ''} />
          <IconButton icon={FolderPlus} label={withKey('Add a project folder', keyFor('addProject'))} size={14} onClick={props.onAdd} />
        </div>
      </div>
      <input className="filter" placeholder="Filter projects or tags" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {allTags.length > 0 && (
        <div className="tag-filter">
          {allTags.map((t) => {
            const on = activeTags.includes(t)
            return (
              <button
                key={t}
                className={`tag ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => setActiveTags((cur) => (on ? cur.filter((x) => x !== t) : [...cur, t]))}
              >
                #{t}
              </button>
            )
          })}
        </div>
      )}

      <div className="project-list">
        {loading && projects.length === 0 && <div className="muted pad">Scanning ~/.claude…</div>}
        {pinned.length > 0 && renderGroup('Pinned', pinned)}
        {groupNames.map((g) => renderGroup(g, groups.get(g)!))}
        {ungrouped.length > 0 && (groupNames.length > 0 || pinned.length > 0 ? renderGroup('Other', ungrouped) : <ul>{ungrouped.map(renderItem)}</ul>)}
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
