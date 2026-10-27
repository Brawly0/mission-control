import { useState } from 'react'
import { FolderPlus, LayoutGrid, List, Play, Search, Star, MoreHorizontal } from 'lucide-react'
import type { GitInfo, Project, Task } from '@shared/types'
import type { Agent } from '../types'
import { orderedProjects } from '@shared/projectOrder'
import { useProjectActions } from './useProjectActions'
import { timeAgo } from '../util'
import { useKeyFor, withKey } from '../shortcuts'
import { matchesFilter } from './HomeView'
import { Avatar, Button, EmptyState, IconButton, Segmented } from './ui'

type Filter = 'all' | 'active' | 'favorites' | 'recent' | 'archived'

interface Props {
  projects: Project[]
  tasks: Task[]
  agents: Agent[]
  git: Record<string, GitInfo>
  showWorktrees: boolean
  onOpen: (path: string) => void
  onNewSession: (p: Project) => void
  onNewProject: () => void
  onChanged: () => void
  onTerminal: (p: Project) => void
}

function remembered<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}

/** Every project as cards or a list, with filters and search. */
export default function ProjectsView({ projects, tasks, agents, git, showWorktrees, onOpen, onNewSession, onNewProject, onChanged, onTerminal }: Props) {
  const keyFor = useKeyFor()
  const [filter, setFilter] = useState<Filter>(() => remembered('mc.projectsFilter', 'all'))
  const [layout, setLayout] = useState<'grid' | 'list'>(() => remembered('mc.projectsLayout', 'grid'))
  const [query, setQuery] = useState('')
  const save = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* not remembered */
    }
  }

  const q = query.trim().toLowerCase()
  const list = orderedProjects(projects)
    .filter((p) => (showWorktrees || !p.worktree) && matchesFilter(p, filter))
    .filter((p) => !q || `${p.name} ${p.folderName} ${p.description ?? ''} ${p.meta.tags.join(' ')} ${p.meta.group ?? ''}`.toLowerCase().includes(q))

  const actions = useProjectActions(projects, onChanged, onOpen, onTerminal, false, list)
  const openTasks = (p: Project) => tasks.filter((t) => t.projectPath.toLowerCase() === p.path.toLowerCase() && t.column !== 'done').length
  const running = (p: Project) => agents.filter((a) => !a.exited && a.projectPath.toLowerCase() === p.path.toLowerCase()).length

  return (
    <div className="page projects-page scroll">
      {actions.overlay}
      <header className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">{projects.filter((p) => !p.worktree).length} projects. Drag to reorder, or right-click for project actions.</p>
        </div>
        <Button variant="primary" icon={FolderPlus} onClick={onNewProject} title={withKey('New project', keyFor('newProject'))}>
          New project
        </Button>
      </header>

      <div className="page-toolbar">
        <div className="toolbar-search">
          <Search size={14} />
          <input placeholder="Search projects, tags, groups" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        </div>
        <Segmented
          value={filter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'favorites', label: 'Favorites' },
            { value: 'recent', label: 'Recent' },
            { value: 'archived', label: 'Archived' }
          ]}
          onChange={(f) => {
            setFilter(f)
            save('mc.projectsFilter', f)
          }}
        />
        <div className="icon-group">
          <IconButton icon={LayoutGrid} label="Cards" active={layout === 'grid'} onClick={() => (setLayout('grid'), save('mc.projectsLayout', 'grid'))} />
          <IconButton icon={List} label="List" active={layout === 'list'} onClick={() => (setLayout('list'), save('mc.projectsLayout', 'list'))} />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={Search} title="No projects match">
          Try another filter, or clear the search.
        </EmptyState>
      ) : (
        <div className={layout === 'grid' ? 'projects-grid' : 'projects-list'}>
          {list.map((p) => {
            const g = git[p.path]
            const n = openTasks(p)
            const live = running(p)
            return (
              <div key={p.path} className={`card big-project ${layout}`} {...actions.events(p)}>
                <button className="big-project-main" onClick={() => onOpen(p.path)} title={p.path}>
                  <Avatar name={p.name} path={p.path} size={layout === 'grid' ? 44 : 32} />
                  <span className="big-project-text">
                    <span className="big-project-name">
                      <span className="strong ellipsis">{p.name}</span>
                      {p.pinned && <Star size={13} className="pin-star" fill="currentColor" />}
                      {p.meta.status && <span className={`status-chip status-${p.meta.status}`}>{p.meta.status}</span>}
                    </span>
                    {layout === 'grid' && (p.description || p.folderName.toLowerCase() !== p.name.toLowerCase()) && (
                      <span className="muted small clamp-2">{p.description || p.folderName}</span>
                    )}
                    <span className="muted small big-project-meta">
                      {p.sessionCount} {p.sessionCount === 1 ? 'chat' : 'chats'} • {n} {n === 1 ? 'task' : 'tasks'}
                      {g?.isRepo && ` • ${g.branch}${g.dirty ? ` (${g.dirty} changed)` : ''}`}
                      {live > 0 && ` • ${live} open`}
                    </span>
                  </span>
                  <span className="muted tiny big-project-when">{p.lastActivity ? timeAgo(p.lastActivity) : 'no chats'}</span>
                </button>
                {layout === 'grid' && p.meta.tags.length > 0 && (
                  <div className="big-project-tags">
                    {p.meta.tags.map((t) => (
                      <span key={t} className="chip chip-tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="big-project-actions">
                <Button size="sm" variant="secondary" icon={Play} className="big-project-go" onClick={() => onNewSession(p)} title={`New ${p.meta.preferredAgent === 'codex' ? 'Codex' : 'Claude'} session here`}>
                  New session
                </Button>
                <IconButton icon={MoreHorizontal} label={`Actions for ${p.name}`} onClick={(e) => actions.show(p, e)} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
