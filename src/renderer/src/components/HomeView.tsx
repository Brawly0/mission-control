import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, Bot, Check, CheckCheck, CheckSquare, Clock3, CodeXml, FileText, Folder, FolderOpen, FolderPlus, LayoutGrid, ListChecks, MessageSquare, MoreVertical, Pin, Play, Settings2, Sun, Users } from 'lucide-react'
import type { AgentTool, DashboardActivity, DashboardDay, Project, RateLimitInfo, RecentSession, Task } from '@shared/types'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { timeAgo } from '../util'
import { dueLabel } from '../due'
import { taskSucceeded } from '@shared/deps'
import { Avatar, MenuButton } from './ui'
import '../home.css'

interface Props {
  agents: Agent[]
  lastOutput: Record<string, number>
  projects: Project[]
  tasks: Task[]
  visible: boolean
  userName: string
  rateLimit: RateLimitInfo | null
  indexRun: number
  onOpenAgent: (id: string) => void
  onOpenProject: (path: string) => void
  onResume: (s: RecentSession) => void
  onNewSession: (p: Project) => void
  onOpenTask: (id: string) => void
  onTaskDone: (id: string) => void
  onTogglePin: (p: Project) => void
  onShortcut: (id: string) => void
  onChat: (tool: AgentTool) => void
  onRunScript: () => void
  currentProject?: string
}
type UsageRange = 'week' | 'month' | 'all'
type TaskFilter = 'open' | 'teams' | 'all'
const DAY = 86_400_000
const TIME_HINT = 'Estimated from gaps of up to 15 minutes between indexed chat events. Parallel chats can overlap; this is not billed or tracked work time.'
function dayKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function calendarDay(date: Date, offset: number): Date { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d }
function weekStart(date: Date): Date { return calendarDay(date, -((date.getDay() + 6) % 7)) }
function timeLabel(minutes: number): string { const n = Math.round(minutes); return minutes > 0 && !n ? '<1m' : n < 60 ? `${n}m` : `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}` }
function greeting(): string { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

/** Shared by the project list's existing filters. */
export function matchesFilter(p: Project, f: 'all' | 'active' | 'favorites' | 'recent' | 'archived'): boolean {
  if (f === 'favorites') return p.pinned
  if (f === 'archived') return p.meta.status === 'done'
  if (f === 'recent') return Date.now() - p.lastActivity < 3 * DAY
  if (f === 'active') return p.meta.status === 'active' || (!p.meta.status && Date.now() - p.lastActivity < 14 * DAY)
  return true
}
function ProviderIcon({ tool }: { tool: AgentTool }) { return tool === 'claude' ? <Sun size={25} strokeWidth={1.8} /> : <CodeXml size={25} strokeWidth={1.8} /> }

function Spark({ values, line = false, label }: { values: number[]; line?: boolean; label: string }) {
  const max = Math.max(1, ...values)
  if (!line) return <span className="hd-spark-bars" role="img" aria-label={label}>{values.map((v, i) => <i key={i} style={{ height: `${v ? Math.max(10, v / max * 100) : 3}%`, opacity: v ? 1 : .25 }} />)}</span>
  const points = values.map((v, i) => `${i * 74 / Math.max(1, values.length - 1)},${35 - v / max * 30}`).join(' ')
  return <svg className="hd-spark" viewBox="0 0 76 40" role="img" aria-label={label}><polygon points={`0,40 ${points} 74,40`} fill="currentColor" opacity=".1" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
}

function Heatmap({ days, count, compact = false, pending = false, unavailable = false }: { days: DashboardDay[]; count: number; compact?: boolean; pending?: boolean; unavailable?: boolean }) {
  const now = new Date(), first = calendarDay(now, -(count - 1)), start = weekStart(first)
  const weeks = Math.ceil((Math.round((calendarDay(now, 0).getTime() - start.getTime()) / DAY) + 1) / 7)
  const byDay = new Map<string, number>()
  for (const day of days) byDay.set(day.day, (byDay.get(day.day) ?? 0) + day.events)
  const max = Math.max(1, ...Array.from({ length: count }, (_, i) => byDay.get(dayKey(calendarDay(first, i))) ?? 0))
  return <div className={`hd-heatmap ${compact ? 'is-compact' : ''}`} aria-label={unavailable ? 'Chat activity unavailable' : `${count}-day chat activity`} aria-busy={pending}>
    {!compact && <div className="hd-heat-labels"><span>Mon</span><span>Wed</span><span>Fri</span></div>}
    <div className="hd-heat-grid" style={{ '--weeks': weeks } as CSSProperties}>{Array.from({ length: weeks * 7 }, (_, i) => {
      const date = calendarDay(start, i), events = byDay.get(dayKey(date)) ?? 0, outside = date < first || date > now
      const level = outside || !events ? 0 : Math.min(4, Math.max(1, Math.ceil(events / max * 4)))
      return <i key={dayKey(date)} data-level={level} className={outside ? 'is-future' : ''} title={`${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}: ${unavailable ? 'activity unavailable' : pending ? 'loading' : `${events} chat activity events`}`} />
    })}</div>
    <div className="hd-heat-legend"><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>More</span></div>
  </div>
}

function usageBars(days: DashboardDay[], range: UsageRange, now: Date, tool: AgentTool) {
  const end = calendarDay(now, 1)
  const start = range === 'week' ? weekStart(now) : range === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : days.length ? new Date(days[0].day + 'T00:00:00') : calendarDay(now, -6)
  const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY)), width = range === 'week' ? 1 : Math.max(1, Math.ceil(span / 7))
  return Array.from({ length: range === 'week' ? 7 : Math.ceil(span / width) }, (_, i) => {
    const from = calendarDay(start, i * width), to = calendarDay(start, (i + 1) * width)
    const minutes = days.filter(d => d.tool === tool && d.day >= dayKey(from) && d.day < dayKey(to)).reduce((n, d) => n + d.activeMinutes, 0)
    return { minutes, label: width === 1 ? from.toLocaleDateString([], { weekday: 'short' }) : from.toLocaleDateString([], { month: 'short', day: 'numeric' }), title: `${from.toLocaleDateString()}${width > 1 ? ` – ${calendarDay(to, -1).toLocaleDateString()}` : ''}` }
  })
}

export default function HomeView(props: Props) {
  const { agents, lastOutput, projects, tasks, visible, userName, onShortcut } = props
  const [activity, setActivity] = useState<DashboardActivity | null>(null)
  const [recent, setRecent] = useState<RecentSession[] | null>(null)
  const [activityError, setActivityError] = useState(false)
  const [recentError, setRecentError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [range, setRange] = useState<UsageRange>('week')
  const [heatRange, setHeatRange] = useState(90)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('open')
  useEffect(() => {
    if (!visible) return
    let current = true
    window.mc.dashboardActivity().then(data => { if (current) { setActivity(data); setActivityError(false) } }).catch(() => { if (current) setActivityError(true) })
    window.mc.recentSessions(8).then(data => { if (current) { setRecent(data); setRecentError(false) } }).catch(() => { if (current) { setRecent([]); setRecentError(true) } })
    return () => { current = false }
  }, [visible, props.indexRun, retry])
  const shownTasks = useMemo(() => tasks.filter(t => !t.teamParentId && (taskFilter === 'all' || taskFilter === 'teams' && !!t.team || taskFilter === 'open' && t.column !== 'done')).sort((a, b) => Number(a.column === 'done') - Number(b.column === 'done') || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.order - b.order).slice(0, 5), [tasks, taskFilter])
  // Home has no persistent terminals or editors. Keep its state while deferring charts offscreen.
  if (!visible) return <div className="home hd scroll" />

  const now = new Date(), monday = weekStart(now), thisWeek = dayKey(monday), previousWeek = dayKey(calendarDay(monday, -7))
  const daily = activity?.days ?? [], weekDays = Array.from({ length: 7 }, (_, i) => dayKey(calendarDay(monday, i)))
  const live = agents.filter(a => !a.exited), real = projects.filter(p => !p.worktree)
  const openTasks = tasks.filter(t => t.column !== 'done' && !t.teamParentId)
  const working = live.filter(a => displayStatus(a, lastOutput[a.id]).cls === 'working').length, needYou = live.filter(a => a.hookStatus === 'needs-input').length
  const weekMinutes = daily.filter(d => d.day >= thisWeek).reduce((n, d) => n + d.activeMinutes, 0), priorMinutes = daily.filter(d => d.day >= previousWeek && d.day < thisWeek).reduce((n, d) => n + d.activeMinutes, 0)
  const since = range === 'week' ? thisWeek : range === 'month' ? dayKey(new Date(now.getFullYear(), now.getMonth(), 1)) : ''
  const usageDays = daily.filter(d => d.day >= since), usageMinutes = usageDays.reduce((n, d) => n + d.activeMinutes, 0)
  const shownProjects = [...real].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 4)
  const weekEvents = weekDays.map(day => daily.filter(d => d.day === day).reduce((n, d) => n + d.events, 0))
  const taskCreated = weekDays.map(day => tasks.filter(t => !t.teamParentId && dayKey(new Date(t.createdAt)) === day).length)
  const projectActive = weekDays.map(day => real.filter(p => p.lastActivity && dayKey(new Date(p.lastActivity)) === day).length)
  const weekAgentStarts = weekDays.map(day => agents.filter(a => dayKey(new Date(a.startedAt)) === day).length)
  const compact = (n: number) => n.toLocaleString([], { notation: 'compact', maximumFractionDigits: 1 })
  const timeline = [
    ...(recent ?? []).map(s => ({ id: `chat-${s.tool}-${s.id}`, at: s.updatedAt, title: `Session with ${s.tool === 'codex' ? 'Codex' : 'Claude'}`, detail: s.title || s.projectName, icon: MessageSquare, tone: s.tool === 'codex' ? 'blue' : 'orange', action: () => props.onResume(s) })),
    ...tasks.filter(t => !t.teamParentId && t.run?.finishedAt).map(t => ({ id: `task-${t.id}`, at: t.run!.finishedAt!, title: t.run?.error ? 'Task needs attention' : t.team ? 'Agent team finished' : 'Task finished', detail: t.title, icon: CheckCheck, tone: t.run?.error ? 'orange' : 'green', action: () => props.onOpenTask(t.id) }))
  ].sort((a, b) => b.at - a.at).slice(0, 5)

  return <div className="home hd scroll">
    <header className="hd-hero">
      <div className="hd-heading"><h1>{greeting()}{userName && <>, <span className="hd-name">{userName}</span></>}</h1><p>Build faster. Smarter. All in one place.</p></div>
      <div className="hd-hero-activity"><span className="hd-date">{now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span><Heatmap days={daily} count={91} compact pending={!activity && !activityError} unavailable={!activity && activityError} /></div>
      <dl className="hd-summary"><div><dd>{activity ? compact(activity.activeDays) : '—'}</dd><dt>active days</dt></div><div><dd>{activity ? compact(activity.sessions) : '—'}</dd><dt>sessions</dt></div><div title={TIME_HINT}><dd>{activity ? timeLabel(activity.activeMinutes) : '—'}</dd><dt>total AI time · est.</dt></div></dl>
    </header>
    <section className="hd-launch-grid" aria-label="Start something new">
      <button className="hd-launch hd-tone-claude" onClick={() => props.onChat('claude')} title={props.currentProject ? `Start Claude in ${props.currentProject}` : 'Start a quick chat with Claude'}><span className="hd-launch-icon"><ProviderIcon tool="claude" /></span><span className="hd-launch-copy"><strong>Chat with Claude</strong><small>Plan, build, debug</small></span><ArrowRight className="hd-launch-arrow" size={16} /></button>
      <button className="hd-launch hd-tone-codex" onClick={() => props.onChat('codex')} title={props.currentProject ? `Start Codex in ${props.currentProject}` : 'Start a quick chat with Codex'}><span className="hd-launch-icon"><ProviderIcon tool="codex" /></span><span className="hd-launch-copy"><strong>Chat with Codex</strong><small>Code, refactor, automate</small></span></button>
      <button className="hd-launch hd-tone-green" onClick={() => onShortcut('newProject')}><span className="hd-launch-icon"><Folder size={23} /></span><span className="hd-launch-copy"><strong>New Project</strong><small>Create or import</small></span></button>
      <button className="hd-launch hd-tone-purple" onClick={() => onShortcut('newTask')}><span className="hd-launch-icon"><CheckSquare size={23} /></span><span className="hd-launch-copy"><strong>New Task</strong><small>Add a task or reminder</small></span></button>
      <button className="hd-launch hd-tone-indigo" onClick={() => onShortcut('templates')}><span className="hd-launch-icon"><LayoutGrid size={23} /></span><span className="hd-launch-copy"><strong>Use Template</strong><small>Start with a template</small></span></button>
    </section>
    <section className="hd-stats" aria-label="Workspace overview">{[
      { label: 'Projects', value: real.length.toLocaleString(), note: `${real.filter(p => p.lastActivity >= monday.getTime()).length} active this week`, icon: Folder, tone: 'green', values: projectActive, chart: 'Projects by most recent activity this week', go: 'goProjects' },
      { label: 'Chats', value: real.reduce((n, p) => n + p.sessionCount, 0).toLocaleString(), note: 'Across your projects', icon: MessageSquare, tone: 'blue', values: weekEvents, chart: 'Chat activity events this week', go: 'goSearch' },
      { label: 'Tasks', value: tasks.filter(t => !t.teamParentId).length.toLocaleString(), note: `${openTasks.length} open`, icon: ListChecks, tone: 'purple', values: taskCreated, chart: 'Tasks created this week', go: 'goTasks' },
      { label: 'Agents', value: String(live.length), note: needYou ? `${needYou} need your attention` : working ? `${working} working now` : 'Open in your workspace', icon: Bot, tone: 'orange', values: weekAgentStarts, chart: 'Current workspace agent start dates', go: 'goAgents' },
      { label: 'AI Time (week)', value: activity ? timeLabel(weekMinutes) : '—', note: activity ? priorMinutes ? `${weekMinutes >= priorMinutes ? '+' : ''}${Math.round((weekMinutes / priorMinutes - 1) * 100)}% vs last week · est.` : 'Estimated active chat time' : activityError ? 'Activity unavailable' : 'Loading activity…', icon: Clock3, tone: 'violet', values: weekDays.map(day => daily.filter(d => d.day === day).reduce((n, d) => n + d.activeMinutes, 0)), chart: TIME_HINT, go: 'goUsage', line: true }
    ].map(stat => <button className={`hd-stat hd-tone-${stat.tone}`} key={stat.label} onClick={() => onShortcut(stat.go)} title={stat.chart}><span className="hd-stat-icon"><stat.icon size={23} /></span><span className="hd-stat-copy"><strong>{stat.value}</strong><span>{stat.label}</span><small>{stat.note}</small></span><Spark values={stat.values} line={stat.line} label={stat.chart} /></button>)}</section>

    {activityError && <div className="hd-data-error" role="status">Activity couldn’t be refreshed. <button onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
    <section className="hd-grid" aria-label="Workspace dashboard">
      <section className="hd-panel hd-usage"><div className="hd-panel-head"><h2>AI Usage</h2><div className="hd-tabs" aria-label="Usage period">{(['week', 'month', 'all'] as const).map(value => <button key={value} aria-pressed={range === value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value === 'week' ? 'This Week' : value === 'month' ? 'This Month' : 'All Time'}</button>)}</div></div>
        {(['claude', 'codex'] as const).map(tool => {
          const minutes = usageDays.filter(d => d.tool === tool).reduce((n, d) => n + d.activeMinutes, 0), bars = usageBars(daily, range, now, tool), max = Math.max(1, ...bars.map(b => b.minutes))
          return <div className={`hd-usage-row hd-provider-${tool}`} key={tool}><span className="hd-provider-icon"><ProviderIcon tool={tool} /></span><span className="hd-provider-copy"><strong>{tool === 'claude' ? 'Claude' : 'Codex'}</strong><span title={TIME_HINT}>{activity ? timeLabel(minutes) : '—'}</span></span><span className="hd-provider-share" title="Share of estimated active chat time">{activity && usageMinutes ? `${Math.round(minutes / usageMinutes * 100)}%` : '—'}</span><div className="hd-week-bars" role="img" aria-label={`${tool} estimated active time by ${range === 'week' ? 'day' : 'date range'}`}>{bars.map((bar, i) => <span className="hd-week-day" key={i} title={`${bar.title}: ${timeLabel(bar.minutes)}`}><i style={{ height: `${bar.minutes ? Math.max(8, bar.minutes / max * 100) : 2}%`, opacity: bar.minutes ? 1 : .2 }} /><small>{bar.label}</small></span>)}</div></div>
        })}<p className="hd-usage-note" title={TIME_HINT}>Estimated chat activity · idle gaps excluded</p>
      </section>
      <section className="hd-panel hd-activity"><div className="hd-panel-head"><h2>Activity</h2><select className="hd-select" value={heatRange} onChange={e => setHeatRange(Number(e.target.value))} aria-label="Activity date range"><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={180}>Last 180 days</option></select></div><Heatmap days={daily} count={heatRange} pending={!activity && !activityError} unavailable={!activity && activityError} /><p className="hd-usage-note">Claude + Codex · each square is one day</p></section>
      <section className="hd-panel hd-quick"><div className="hd-panel-head"><h2>Quick Actions</h2></div><div className="hd-quick-grid">{[
        { label: 'Open Projects', icon: FolderOpen, action: () => onShortcut('goProjects'), tone: 'indigo' },
        { label: 'Workspace Files', icon: FileText, action: () => onShortcut('tabDocs'), tone: 'purple', needsProject: true },
        { label: 'View Chats', icon: MessageSquare, action: () => onShortcut('goSearch'), tone: 'blue' },
        { label: 'Run Script', icon: Play, action: props.onRunScript, tone: 'green', needsProject: true },
        { label: 'Manage Agents', icon: Users, action: () => onShortcut('goAgents'), tone: 'purple' },
        { label: 'Settings', icon: Settings2, action: () => onShortcut('settings'), tone: 'indigo' }
      ].map(action => <button key={action.label} className={`hd-tone-${action.tone}`} onClick={action.action} disabled={action.needsProject && !props.currentProject} title={action.needsProject ? props.currentProject ? `${action.label} in ${props.currentProject}` : 'Select a project to use this action' : action.label}><span><action.icon size={18} /></span>{action.label}</button>)}</div></section>

      <section className="hd-panel hd-projects"><div className="hd-panel-head"><h2>Recent Projects</h2><button className="hd-link" onClick={() => onShortcut('goProjects')}>View all <ArrowRight size={12} /></button></div><div className="hd-project-list">{!shownProjects.length && <div className="hd-empty"><FolderPlus size={25} /><p>Your next idea starts here.</p><button className="hd-link" onClick={() => onShortcut('newProject')}>Create or import a project <ArrowRight size={13} /></button></div>}{shownProjects.map(p => <div className="hd-project-row" key={p.path}>
        <Avatar name={p.name} path={p.path} size={31} /><button className="hd-project-main" onClick={() => props.onOpenProject(p.path)} title={p.path}><strong>{p.name}</strong><small>{p.description || p.folderName}</small></button><span className="hd-project-count">{p.sessionCount} chats<small>{tasks.filter(t => t.projectPath.toLowerCase() === p.path.toLowerCase() && t.column !== 'done' && !t.teamParentId).length} tasks</small></span><span className={`hd-project-status ${p.meta.status ?? 'active'}`}>{p.meta.status === 'done' ? 'Done' : p.meta.status === 'paused' ? 'Paused' : 'Active'}</span><span className="hd-project-time">{p.lastActivity ? timeAgo(p.lastActivity) : 'New'}</span><MenuButton align="right" trigger={open => <button className="hd-project-menu" aria-label={`Actions for ${p.name}`} onClick={open}><MoreVertical size={14} /></button>} items={[{ label: 'Open project', icon: FolderOpen, onSelect: () => props.onOpenProject(p.path) }, { label: 'New session', icon: Play, onSelect: () => props.onNewSession(p) }, { label: p.pinned ? 'Unpin' : 'Pin to sidebar', icon: Pin, onSelect: () => props.onTogglePin(p) }, { label: 'Open in Explorer', icon: FolderOpen, onSelect: () => window.mc.openInExplorer(p.path) }]} />
      </div>)}</div></section>
      <section className="hd-panel hd-tasks"><div className="hd-panel-head"><h2>Tasks</h2><button className="hd-link" onClick={() => onShortcut('goTasks')}>View all <ArrowRight size={12} /></button></div><div className="hd-tabs" aria-label="Task filter">{(['open', 'teams', 'all'] as const).map(filter => <button key={filter} className={taskFilter === filter ? 'active' : ''} aria-pressed={taskFilter === filter} onClick={() => setTaskFilter(filter)}>{filter === 'open' ? 'Open Tasks' : filter === 'teams' ? 'Agent Teams' : 'All'}</button>)}</div><ul className="hd-task-list">{!shownTasks.length && <li className="hd-empty"><p>{taskFilter === 'teams' ? 'Split a task into agents to build with a team.' : 'A clear task is the first step.'}</p><button className="hd-link" onClick={() => onShortcut('newTask')}>Add a task <ArrowRight size={12} /></button></li>}{shownTasks.map(task => {
        const canComplete = task.column !== 'done' && task.column !== 'running' && (!task.team || task.team.phase === 'review') && task.run?.checks?.status !== 'running', due = dueLabel(task)
        return <li key={task.id}><button className="hd-task-check" aria-label={task.column === 'done' ? `${task.title} is done` : `Mark ${task.title} done`} disabled={!canComplete} title={canComplete ? 'Mark done' : 'Open the task to follow its progress'} onClick={() => props.onTaskDone(task.id)}>{task.column === 'done' ? <Check size={13} /> : <span />}</button><button className="hd-task-title" onClick={() => props.onOpenTask(task.id)} title={`${task.title}\n${task.projectName}`}>{task.title}</button><span className={`hd-task-state ${task.column}`}>{task.team && task.column === 'todo' ? 'Team' : task.column === 'todo' ? 'To do' : task.column === 'running' ? 'Running' : task.column === 'review' ? taskSucceeded(task) ? 'Review' : 'Stopped' : 'Done'}</span><span className={`hd-task-due ${due.tone}`}>{due.text || 'No date'}</span></li>
      })}</ul></section>
      <section className="hd-panel hd-recent"><div className="hd-panel-head"><h2>Recent Activity</h2><button className="hd-link" onClick={() => onShortcut('goSearch')}>View all <ArrowRight size={12} /></button></div><div className="hd-timeline">{recent === null && <p className="hd-loading" role="status">Loading recent activity…</p>}{recentError && <p className="hd-data-error">Chats couldn’t be loaded. <button onClick={() => setRetry(v => v + 1)}>Retry</button></p>}{recent !== null && !timeline.length && !recentError && <div className="hd-empty"><MessageSquare size={25} /><p>Your chats and finished tasks will appear here.</p></div>}{timeline.map(event => <button className={`hd-event hd-tone-${event.tone}`} key={event.id} onClick={event.action} title={event.detail}><span className="hd-event-icon"><event.icon size={16} /></span><span className="hd-event-copy"><strong>{event.title}</strong><small>{event.detail}</small></span><span className="hd-event-time">{timeAgo(event.at)}</span></button>)}</div></section>
    </section>
    {!!live.length && <div className="hd-live-strip"><span>Open agents</span>{live.slice(0, 4).map(agent => { const status = displayStatus(agent, lastOutput[agent.id]); return <button className="hd-agent-link" key={agent.id} onClick={() => props.onOpenAgent(agent.id)} title={`${agent.title}: ${status.label}`}><span className={`dot ${status.cls}`} />{agent.title}</button> })}</div>}
  </div>
}
