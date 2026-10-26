import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Bot,
  ChevronRight,
  CircleCheck,
  Circle,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Layers,
  ListChecks,
  ListPlus,
  MessageSquareDashed,
  MessagesSquare,
  MoreVertical,
  Pin,
  Play,
  Plus,
  Star
} from 'lucide-react'
import type { ClaudeStatus, Project, RateLimitInfo, RecentSession, Task, UsageReport } from '@shared/types'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { windowLabel } from '@shared/planUsage'
import { isScratchPath } from '@shared/projectLook'
import { elapsed, timeAgo } from '../util'
import { useKeyFor, withKey } from '../shortcuts'
import { dueLabel } from '../due'
import { Avatar, Button, MenuButton } from './ui'

interface Props {
  agents: Agent[]
  lastOutput: Record<string, number>
  projects: Project[]
  tasks: Task[]
  visible: boolean
  userName: string
  rateLimit: RateLimitInfo | null
  /** Bumped by the index; refreshes chat counts and the week's usage. */
  indexRun: number
  onOpenAgent: (id: string) => void
  onOpenProject: (path: string) => void
  onResume: (s: RecentSession) => void
  onNewSession: (p: Project) => void
  onOpenTask: (id: string) => void
  onTaskDone: (id: string) => void
  onTogglePin: (p: Project) => void
  /** Runs a shortcut's action, so the cards do exactly what their keys do. */
  onShortcut: (id: string) => void
  currentProject?: string
}

type Filter = 'all' | 'active' | 'favorites' | 'recent' | 'archived'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recent' },
  { id: 'archived', label: 'Archived' }
]
const DAY = 86_400_000

export function matchesFilter(p: Project, f: Filter): boolean {
  if (f === 'favorites') return p.pinned
  if (f === 'archived') return p.meta.status === 'done'
  if (f === 'recent') return Date.now() - p.lastActivity < 3 * DAY
  if (f === 'active') return p.meta.status === 'active' || (!p.meta.status && Date.now() - p.lastActivity < 14 * DAY)
  return true
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function HomeView(props: Props) {
  const { agents, lastOutput, projects, tasks, visible, userName, rateLimit, onOpenAgent, onOpenProject, onResume, onShortcut } = props
  const keyFor = useKeyFor()
  const [recent, setRecent] = useState<RecentSession[] | null>(null)
  const [week, setWeek] = useState<UsageReport | null>(null)
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const [filter, setFilter] = useState<Filter>(() => {
    try {
      return (localStorage.getItem('mc.homeFilter') as Filter) || 'all'
    } catch {
      return 'all'
    }
  })

  useEffect(() => {
    if (!visible) return
    window.mc.recentSessions(9).then(setRecent).catch(() => setRecent([]))
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    window.mc.usageReport(monday.getTime()).then(setWeek).catch(() => setWeek(null))
    window.mc.claudeStatus().then(setStatus).catch(() => undefined)
  }, [visible, props.indexRun])

  const pickFilter = (f: Filter) => {
    setFilter(f)
    try {
      localStorage.setItem('mc.homeFilter', f)
    } catch {
      /* not remembered */
    }
  }

  const live = agents.filter((a) => !a.exited)
  const real = projects.filter((p) => !p.worktree)
  const totalChats = real.reduce((t, p) => t + p.sessionCount, 0)
  const openTasks = tasks.filter((t) => t.column !== 'done')
  // Working right now: a hook said so, or (plain shells) it printed in the last few seconds. Open but idle doesn't count.
  const working = live.filter((a) => displayStatus(a, lastOutput[a.id]).cls === 'working').length
  const needYou = live.filter((a) => a.hookStatus === 'needs-input').length

  const shownProjects = real.filter((p) => matchesFilter(p, filter)).slice(0, 8)
  const taskCount = (p: Project) => tasks.filter((t) => t.projectPath.toLowerCase() === p.path.toLowerCase() && t.column !== 'done').length

  // Due first (earliest), then the next To do tasks without a date.
  const upcoming = useMemo(() => {
    const open = tasks.filter((t) => t.column === 'todo' || t.column === 'running')
    const dated = open.filter((t) => t.dueAt).sort((a, b) => a.dueAt! - b.dueAt!)
    const undated = open.filter((t) => !t.dueAt && t.column === 'todo').sort((a, b) => a.order - b.order)
    return [...dated, ...undated].slice(0, 5)
  }, [tasks])

  // Monday to Sunday of this week.
  const days = useMemo(() => {
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => {
      // Calendar days, not 24-hour steps: a daylight-saving change would make two "Sat"s.
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const key = d.toLocaleDateString('sv')
      const row = week?.byDay.find((r) => r.day === key)
      return { label: d.toLocaleDateString([], { weekday: 'short' }), cost: row?.cost ?? 0, future: d.getTime() > Date.now() }
    })
  }, [week])
  const maxDay = Math.max(0.01, ...days.map((d) => d.cost))
  const weekTasks = tasks.filter((t) => t.createdAt >= Date.now() - 7 * DAY).length

  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
  const summary = live.length
    ? [
        today,
        `${live.length} ${live.length === 1 ? 'agent' : 'agents'} open`,
        working > 0 && `${working} working`,
        needYou > 0 && `${needYou} need${needYou === 1 ? 's' : ''} you`
      ]
        .filter(Boolean)
        .join(' · ')
    : `${today} · No agents open. Ready when you are.`

  return (
    <div className="home dash scroll">
      <section className="dash-top">
        <div className="card hero-card">
          <div className="hero-glow" />
          <div className="hero-text">
            <h1>
              {greeting()}
              {userName && (
                <>
                  , <span className="hero-name">{userName}</span>
                </>
              )}
            </h1>
            <p>{summary}</p>
          </div>
        </div>
      </section>

      <section className="dash-stats">
        {[
          { icon: FolderKanban, tone: 'green', value: real.length, label: 'Projects', go: 'goProjects' },
          { icon: MessagesSquare, tone: 'blue', value: totalChats, label: 'Chats in your projects', go: 'goSearch' },
          { icon: ListChecks, tone: 'purple', value: openTasks.length, label: 'Open tasks', go: 'goTasks' },
          { icon: Bot, tone: 'orange', value: live.length, label: needYou ? `Agents open · ${needYou} need you` : working ? `Agents open · ${working} working` : 'Agents open', go: 'goAgents' }
        ].map((s) => (
          <button key={s.label} className="card dash-stat" onClick={() => onShortcut(s.go)} title={withKey(s.label, keyFor(s.go))}>
            <span className={`tile tile-${s.tone}`}>
              <s.icon size={22} />
            </span>
            <span className="dash-stat-text">
              <span className="dash-stat-value">{s.value}</span>
              <span className="muted small ellipsis">{s.label}</span>
            </span>
            <ChevronRight size={17} className="dash-go" />
          </button>
        ))}
      </section>

      <section className="dash-actions">
        {[
          { id: 'newSession', icon: Plus, title: 'New session', sub: props.currentProject ? `Claude in ${props.currentProject}` : 'Start a Claude Code session', primary: true },
          { id: 'newTask', icon: ListPlus, title: 'New task', sub: 'A task or a reminder', tone: 'green' },
          { id: 'newProject', icon: FolderPlus, title: 'New project', sub: 'Create or add a folder', tone: 'purple' },
          { id: 'quickChat', icon: MessageSquareDashed, title: 'Quick chat', sub: 'A throwaway chat, no project', tone: 'blue' }
        ].map((a) => (
          <button key={a.id} className={`card dash-action ${a.primary ? 'primary' : ''}`} onClick={() => onShortcut(a.id)} title={withKey(a.title, keyFor(a.id))}>
            <span className={`tile ${a.primary ? 'tile-white' : `tile-${a.tone}`}`}>
              <a.icon size={20} />
            </span>
            <span className="dash-action-text">
              <span className="strong">{a.title}</span>
              <span className="small ellipsis">{a.sub}</span>
            </span>
            {a.primary && <ChevronRight size={18} />}
          </button>
        ))}
      </section>

      <section className="dash-main">
        <div className="card dash-panel">
          <div className="panel-head">
            <h2>Recent activity</h2>
            <button className="panel-link" onClick={() => onShortcut('goSearch')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="activity-list">
            {recent === null && <div className="muted pad">Loading…</div>}
            {recent?.length === 0 && <div className="muted pad">No chats yet. Start a session and it shows here.</div>}
            {recent?.map((s) => {
              const sub = s.firstPrompt && s.firstPrompt.split('\n')[0].trim() !== s.title ? s.firstPrompt.split('\n')[0] : ''
              return (
                <div key={s.id} className="activity-row">
                  <Avatar name={s.projectName} path={s.projectPath} size={32} />
                  <button className="activity-main" onClick={() => onOpenProject(s.projectPath)}>
                    <span className="ellipsis">{s.title}</span>
                    <span className="muted small ellipsis">
                      {s.projectName}
                      {sub && ` • ${sub}`}
                    </span>
                  </button>
                  <span className="muted small activity-time">{timeAgo(s.updatedAt)}</span>
                  <button className="activity-resume" title="Resume in a new agent" onClick={() => onResume(s)}>
                    <Play size={13} fill="currentColor" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card dash-panel">
          <div className="panel-head">
            <h2>Your projects</h2>
            <button className="panel-link" onClick={() => onShortcut('goProjects')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          {shownProjects.length === 0 ? (
            <div className="muted pad">No projects match “{FILTERS.find((f) => f.id === filter)?.label}”.</div>
          ) : (
            <div className="project-cards">
              {shownProjects.map((p) => (
                <ProjectCard key={p.path} project={p} openTasks={taskCount(p)} running={live.filter((a) => a.projectPath.toLowerCase() === p.path.toLowerCase()).length} {...props} />
              ))}
            </div>
          )}
        </div>

        <div className="dash-side">
          <div className="card dash-panel">
            <div className="panel-head">
              <h2>Open agents</h2>
              <button className="panel-link" onClick={() => onShortcut('goAgents')}>
                View all <ArrowRight size={14} />
              </button>
            </div>
            {live.length === 0 ? (
              <div className="running-empty">
                <Layers size={34} strokeWidth={1.4} />
                <div className="strong">No agents open</div>
                <div className="muted small">Start a session or a task to begin</div>
                <Button variant="primary" icon={Plus} onClick={() => onShortcut('newSession')}>
                  Start an agent
                </Button>
              </div>
            ) : (
              <div className="running-list">
                {live.slice(0, 5).map((a) => {
                  const st = displayStatus(a, lastOutput[a.id])
                  return (
                    <button key={a.id} className={`running-row status-${st.cls}`} onClick={() => onOpenAgent(a.id)}>
                      <Avatar name={a.projectName} path={a.projectPath} size={26} />
                      <span className="running-text">
                        <span className="ellipsis">{a.title}</span>
                        <span className="small ellipsis">
                          <span className={`dot ${st.cls}`} /> {st.label}
                        </span>
                      </span>
                      <span className="muted small">{elapsed(a.startedAt)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card dash-panel">
            <div className="panel-head">
              <h2>Upcoming tasks</h2>
              <button className="panel-link" onClick={() => onShortcut('goTasks')}>
                View all <ArrowRight size={14} />
              </button>
            </div>
            {upcoming.length === 0 ? (
              <div className="muted small pad">Nothing due. Add a task with a due date and it shows here.</div>
            ) : (
              <ul className="upcoming-list">
                {upcoming.map((t) => {
                  const due = dueLabel(t)
                  return (
                    <li key={t.id}>
                      <button className="upcoming-check" title="Mark done" onClick={() => props.onTaskDone(t.id)}>
                        <Circle size={17} />
                        <CircleCheck size={17} />
                      </button>
                      <button className="upcoming-title ellipsis" onClick={() => props.onOpenTask(t.id)} title={`${t.title}\n${t.projectName}`}>
                        {t.title}
                      </button>
                      <span className={`upcoming-due ${due.tone}`}>{due.text || (t.column === 'running' ? 'Running' : '')}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="dash-bottom">
        <div className="card dash-panel">
          <h2>Quick filters</h2>
          <div className="filter-chips">
            {FILTERS.map((f) => (
              <button key={f.id} className={`chip-btn ${filter === f.id ? 'on' : ''}`} onClick={() => pickFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card dash-panel week-panel">
          <h2>Usage this week</h2>
          <div className="week-body">
            <div className="week-bars" title="Estimated cost per day at API prices">
              {days.map((d) => (
                <div key={d.label} className={`week-day ${d.future ? 'future' : ''}`}>
                  <span className="week-bar" style={{ height: `${Math.max(4, (d.cost / maxDay) * 100)}%` }} title={`$${d.cost.toFixed(2)}`} />
                  <span className="muted tiny">{d.label}</span>
                </div>
              ))}
            </div>
            <div className="week-nums">
              <div>
                <span className="week-num">{week?.totals.sessions ?? 0}</span>
                <span className="muted small">Chats</span>
              </div>
              <div>
                <span className="week-num accent">{weekTasks}</span>
                <span className="muted small">Tasks created</span>
              </div>
              <div>
                <span className="week-num">{week?.byProject.filter((p) => p.cost > 0 && !isScratchPath(p.projectPath)).length ?? 0}</span>
                <span className="muted small">Active projects</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card dash-panel">
          <h2>System status</h2>
          <div className="status-body">
            <div className={`status-claude ${status?.loggedIn ? 'ok' : status ? 'bad' : ''}`}>
              <span className="dot" />
              <span>
                <span className="strong">Claude Code</span>
                <span className="small">{!status ? 'Checking…' : !status.installed ? 'Not installed' : status.loggedIn ? 'Connected' : 'Not logged in'}</span>
              </span>
            </div>
            <div className="status-meters">
              {(rateLimit?.windows.length ? rateLimit.windows : [{ name: 'five_hour', utilization: 0, resetsAt: 0 }, { name: 'seven_day', utilization: 0, resetsAt: 0 }]).map((w) => {
                const pct = Math.round(w.utilization * 100)
                return (
                  <div key={w.name} className="meter" title={w.resetsAt ? `Resets ${new Date(w.resetsAt).toLocaleString()}` : rateLimit?.error ?? 'Checking your plan limits…'}>
                    <div className="meter-label">
                      <span>{windowLabel(w.name, true)}</span>
                      <span>{rateLimit ? `${pct}%` : '–'}</span>
                    </div>
                    <div className="meter-track">
                      <span className={pct >= 90 ? 'high' : pct >= 70 ? 'warn' : ''} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function ProjectCard(props: Props & { project: Project; openTasks: number; running: number }) {
  const { project: p } = props
  return (
    <div className={`project-card ${p.pinned ? 'pinned' : ''}`}>
      <button className="project-card-main" onClick={() => props.onOpenProject(p.path)} title={p.description || p.path}>
        <Avatar name={p.name} path={p.path} size={36} />
        <span className="project-card-text">
          <span className="strong ellipsis">{p.name}</span>
          <span className="muted small">
            {p.sessionCount} {p.sessionCount === 1 ? 'chat' : 'chats'} • {props.openTasks} {props.openTasks === 1 ? 'task' : 'tasks'}
          </span>
          <span className="muted tiny">{p.lastActivity ? `Updated ${timeAgo(p.lastActivity)}` : 'No chats yet'}</span>
        </span>
      </button>
      {props.running > 0 && <span className="project-card-live" title={`${props.running} agent${props.running === 1 ? "" : "s"} open`} />}
      {p.pinned && <Star size={13} className="project-card-star" fill="currentColor" />}
      <MenuButton
        align="right"
        trigger={(toggle) => (
          <button className="project-card-menu" aria-label="Project actions" onClick={toggle}>
            <MoreVertical size={15} />
          </button>
        )}
        items={[
          { label: 'Open', icon: FolderKanban, onSelect: () => props.onOpenProject(p.path) },
          { label: 'New session', icon: Play, onSelect: () => props.onNewSession(p) },
          { label: p.pinned ? 'Unpin' : 'Pin to sidebar', icon: Pin, onSelect: () => props.onTogglePin(p) },
          { label: 'Open in Explorer', icon: FolderOpen, onSelect: () => window.mc.openInExplorer(p.path) }
        ]}
      />
    </div>
  )
}
