import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BarChart3, BookOpen, Bot, Check, ChevronRight, FileStack, FolderKanban, FolderPlus, House, Inbox, KanbanSquare, MessagesSquare, NotebookPen, PanelLeftClose, Pause, RefreshCw, Search, Star, Wand2 } from 'lucide-react'
import BrandMark from './BrandMark'
import AgentConnections from './AgentConnections'
import { useProjectActions } from './useProjectActions'
import { orderedProjects } from '@shared/projectOrder'
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
  onTerminal: (project?: Project) => void
  taskCounts: { running: number; review: number }
  /** Inbox items waiting on you (not counting "good to know" ones). */
  inbox: { total: number; urgent: number }
  /** Monthly budget state, keyed by lower-cased project path. */
  budgets: Record<string, BudgetState>
  /** Icon-only rail instead of the full sidebar. */
  collapsed: boolean
  onOpenTemplates: () => void
  onToggleCollapsed: () => void
}

/**
 * Projects in the order the sidebar shows them: pinned, then groups by name, then the rest,
 * saved order within each section. Alt+Up/Down follow the same order.
 */
export function sidebarOrder(projects: Project[], showWorktrees: boolean): Project[] {
  const visible = projects.filter((p) => showWorktrees || !p.worktree)
  const ordered = orderedProjects(visible)
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
  const [filterOpen, setFilterOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(() => {
    try {
      return localStorage.getItem('mc.navMoreOpen') === '1'
    } catch {
      return false
    }
  })
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
    const counts = new Map<string, { running: number; working: number; attention: number }>()
    for (const a of agents) {
      if (a.exited) continue
      const key = a.projectPath.toLowerCase()
      const c = counts.get(key) ?? { running: 0, working: 0, attention: 0 }
      c.running++
      if (a.hookStatus === 'working') c.working++
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
  const actions = useProjectActions(projects, props.onRefresh, props.onSelect, props.onTerminal, true, visible)
  // Saved order within each section; new projects follow the defaults.
  const ordered = orderedProjects(visible)
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
      <li key={p.path} {...actions.events(p)}>
        <button
          className={`project-item ${selected ? 'selected' : ''} ${p.meta.status === 'done' ? 'is-done' : ''}`}
          onClick={() => props.onSelect(p.path)}
          title={[
            p.name,
            p.description,
            `${p.sessionCount} ${p.sessionCount === 1 ? 'chat' : 'chats'}${p.lastActivity ? ` · ${timeAgo(p.lastActivity)}` : ''}${g?.isRepo ? ` · ${g.branch}${g.dirty ? ` (${g.dirty} changed)` : ''}` : ''}`,
            p.path
          ]
            .filter(Boolean)
            .join('\n')}
        >
          <Avatar name={p.name} path={p.path} size={22} />
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
          </div>
          <div className="project-item-end">
            {counts ? (
              <span className={`run-pill ${counts.attention ? 'attention' : ''}`} title={`${counts.running} open${counts.working ? `, ${counts.working} working` : ''}${counts.attention ? `, ${counts.attention} need you` : ''}`}>
                {/* Only a working agent pulses: an endless animation keeps the GPU busy. */}
                <span className={`dot ${counts.attention ? 'needs-input' : counts.working ? 'working' : 'ready'}`} />
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

  const navItems: { view: View | 'templates'; icon: typeof House; label: string; shortcut: string; badge?: ReactNode }[] = [
    { view: 'home', icon: House, label: 'Home', shortcut: 'goHome' },
    {
      view: 'inbox',
      icon: Inbox,
      label: 'Inbox',
      shortcut: 'goInbox',
      badge: props.inbox.total > 0 && (
        <span className={`count ${props.inbox.urgent ? 'count-attention' : 'count-review'}`} title={`${props.inbox.total} waiting on you${props.inbox.urgent ? `, ${props.inbox.urgent} urgent` : ''}`}>
          {props.inbox.total}
        </span>
      )
    },
    { view: 'projects', icon: FolderKanban, label: 'Projects', shortcut: 'goProjects', badge: <span className="count">{projects.filter((p) => !p.worktree).length}</span> },
    {
      view: 'agents',
      icon: Bot,
      label: 'Agents',
      shortcut: 'goAgents',
      badge: (
        <>
          {attention > 0 && <span className="count count-attention">{attention}</span>}
          {live.length > 0 && <span className="count">{live.length}</span>}
        </>
      )
    },
    {
      view: 'tasks',
      icon: KanbanSquare,
      label: 'Tasks',
      shortcut: 'goTasks',
      badge: (
        <>
          {props.taskCounts.review > 0 && (
            <span className="count count-review" title="Waiting for your review">
              {props.taskCounts.review}
            </span>
          )}
          {props.taskCounts.running > 0 && <span className="count">{props.taskCounts.running}</span>}
        </>
      )
    },
    { view: 'search', icon: MessagesSquare, label: 'Chats', shortcut: 'goSearch' },
    { view: 'notebook', icon: NotebookPen, label: 'Notebook', shortcut: 'goNotebook' },
    { view: 'templates', icon: FileStack, label: 'Templates', shortcut: 'templates' },
    { view: 'knowledge', icon: BookOpen, label: 'Knowledge', shortcut: 'goKnowledge' },
    { view: 'skills', icon: Wand2, label: 'Skills', shortcut: 'goSkills' },
    { view: 'usage', icon: BarChart3, label: 'Usage & Insights', shortcut: 'goUsage' }
  ]
  const go = (v: View | 'templates') => (v === 'templates' ? props.onOpenTemplates() : props.onNavigate(v))
  // The first six are used all the time; the rest sit in a "More" group (open while one of them is the current page).
  const mainNav = navItems.slice(0, 6)
  const moreNav = navItems.slice(6)
  const showMore = moreOpen || moreNav.some((n) => n.view === view)
  const toggleMore = () => {
    setMoreOpen(!moreOpen)
    try {
      localStorage.setItem('mc.navMoreOpen', moreOpen ? '0' : '1')
    } catch {
      /* just won't persist */
    }
  }
  const navButton = (n: (typeof navItems)[number]) => (
    <button key={n.view} className={`nav-item ${view === n.view ? 'active' : ''}`} onClick={() => go(n.view)} title={withKey(n.label, keyFor(n.shortcut))}>
      <n.icon size={17} strokeWidth={1.9} />
      <span>{n.label}</span>
      <span className="nav-end">{n.badge}</span>
    </button>
  )

  if (props.collapsed) {
    return (
      <aside className="sidebar rail">
        <div className="connection-brand">
          <button className="brand-mark rail-brand" title={withKey('Show sidebar', keyFor('toggleSidebar'))} onClick={props.onToggleCollapsed}>
            <BrandMark size={34} />
          </button>
          <AgentConnections onUsage={() => props.onNavigate('usage')} onTerminal={() => props.onTerminal()} />
        </div>
        <button className="rail-item" title={withKey('Command palette', keyFor('palette'))} onClick={props.onOpenPalette}>
          <Search size={17} />
        </button>
        <nav className="rail-nav">
          {navItems.map((n) => (
            <button key={n.view} className={`rail-item ${view === n.view ? 'active' : ''}`} title={withKey(n.label, keyFor(n.shortcut))} onClick={() => go(n.view)}>
              <n.icon size={17} strokeWidth={1.9} />
              {n.view === 'agents' && live.length > 0 && <span className={`rail-dot ${attention ? 'attention' : ''}`} />}
              {n.view === 'tasks' && props.taskCounts.review > 0 && <span className="rail-dot review" />}
              {n.view === 'inbox' && props.inbox.total > 0 && <span className={`rail-dot ${props.inbox.urgent ? 'attention' : 'review'}`} />}
            </button>
          ))}
        </nav>
        <div className="rail-projects">
          {sidebarOrder(projects, showWorktrees).map((p) => (
            <button
              key={p.path}
              {...actions.events(p)}
              className={`rail-project ${view === 'project' && p.path === selectedPath ? 'active' : ''}`}
              title={[p.name, p.description].filter(Boolean).join(' · ')}
              onClick={() => props.onSelect(p.path)}
            >
              <Avatar name={p.name} path={p.path} size={30} />
              {runningByProject.get(p.path.toLowerCase()) && <span className="rail-dot working" />}
            </button>
          ))}
        </div>
        {actions.overlay}
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <AgentConnections onUsage={() => props.onNavigate('usage')} onTerminal={() => props.onTerminal()} />
        <div className="brand-text">
          <div className="brand-name">Mission Control</div>
          <div className="brand-sub">for Claude &amp; Codex</div>
        </div>
        <IconButton icon={PanelLeftClose} label={withKey('Hide sidebar', keyFor('toggleSidebar'))} size={15} className="brand-collapse" onClick={props.onToggleCollapsed} />
      </div>

      <nav className="nav">
        {mainNav.map(navButton)}
        <button className="nav-item nav-more" onClick={toggleMore} aria-expanded={showMore} title={moreNav.map((n) => n.label).join(', ')}>
          <ChevronRight size={17} strokeWidth={1.9} className={showMore ? 'rot90' : ''} />
          <span>More</span>
        </button>
        {showMore && moreNav.map(navButton)}
      </nav>

      <div className="section-head">
        <span>Projects</span>
        <div className="section-actions">
          <IconButton icon={Search} label="Filter projects" size={14} active={filterOpen} onClick={() => setFilterOpen((o) => !o)} />
          <IconButton icon={RefreshCw} label={withKey('Refresh', keyFor('refresh'))} size={14} onClick={props.onRefresh} className={loading ? 'spinning' : ''} />
          <IconButton icon={FolderPlus} label={withKey('Add a project folder', keyFor('addProject'))} size={14} onClick={props.onAdd} />
        </div>
      </div>
      {(filterOpen || filter) && (
        <input className="filter" autoFocus placeholder="Filter projects or tags" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setFilter(''), setFilterOpen(false))} />
      )}
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
        {ungrouped.length > 0 && renderGroup(groupNames.length > 0 ? 'Other projects' : 'All projects', ungrouped)}
        {!loading && visible.length === 0 && <div className="muted pad">{projects.length === 0 ? 'Add your first project with the folder button above.' : 'No projects match.'}</div>}
      </div>

      {hiddenCount > 0 && (
        <label className="sidebar-footer">
          <input type="checkbox" checked={showWorktrees} onChange={(e) => props.onToggleWorktrees(e.target.checked)} />
          Show worktrees &amp; scratch ({hiddenCount})
        </label>
      )}
      {actions.overlay}
    </aside>
  )
}
