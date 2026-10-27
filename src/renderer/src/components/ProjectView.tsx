import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ChevronDown,
  Coins,
  LayoutDashboard,
  Code2,
  FileText,
  FolderInput,
  FolderOpen,
  GitBranch,
  GitFork,
  Hexagon,
  History,
  Layers,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  SquareTerminal,
  Star,
  Terminal,
  Trash2
} from 'lucide-react'
import type { AgentTool, BudgetState, GitInfo, Project, SessionSummary, UsageTotals } from '@shared/types'
import { TOOL_NAME, otherTool } from '@shared/handoff'
import type { LaunchOptions } from '../types'
import { resumeArgs } from '../agentStatus'
import { errorMessage, formatBytes, formatCost, shortPath, timeAgo } from '../util'
import SessionViewer from './SessionViewer'
import ChangesPanel from './ChangesPanel'
import OverviewPanel from './OverviewPanel'
import GitInitDialog from './GitInitDialog'
import IdentityDialog from './IdentityDialog'
import { useKeyFor, useShortcutEvent, withKey } from '../shortcuts'
import { Avatar, Button, EmptyState, IconButton, MenuButton, Segmented, ToolBadge } from './ui'
import { PlanShare } from '../planRate'
import { unclearTitle } from '@shared/projectLook'
import { useToast } from '../toast'

// The docs vault (with its graph) loads when its tab is first opened.
const VaultView = lazy(() => import('./VaultView'))
const RunPanel = lazy(() => import('./RunPanel'))
const ProjectBriefingPanel = lazy(() => import('./ProjectBriefingPanel'))

interface Props {
  project: Project
  /** Every project, for Move to project. */
  projects: Project[]
  git?: GitInfo
  visible: boolean
  groups: string[]
  /** A chat to show, e.g. one picked in search; the nonce re-triggers the same chat. */
  focus?: { sessionId: string; nonce: number }
  onLaunch: (opts: LaunchOptions) => void
  /** Opens several chats as agents at once (grid). */
  onOpenMany: (chats: SessionSummary[]) => void
  /** Chats open as agents right now, by session id. */
  openSessions: Set<string>
  onLaunchWorktree: (project: Project) => void
  onStartFromBriefing: () => void
  /** Starts the other agent from a handoff of a chat (the newest one by `from` when no id is given). */
  onHandOff: (from: AgentTool, to: AgentTool, sessionId?: string) => void
  budget?: BudgetState
  onChanged: () => void
}

type Tab = 'overview' | 'chats' | 'changes' | 'docs' | 'run' | 'briefing'

export default function ProjectView({ project, projects, git, visible, groups, focus, budget, onLaunch, onOpenMany, openSessions, onLaunchWorktree, onStartFromBriefing, onHandOff, onChanged }: Props) {
  const toast = useToast()
  const [naming, setNaming] = useState(false)
  const [gitInitOpen, setGitInitOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const keyFor = useKeyFor()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [usage, setUsage] = useState<Record<string, UsageTotals>>({})
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  const hasChats = project.keys.length > 0 || project.sessionCount > 0
  const [tab, setTab] = useState<Tab>(hasChats ? 'chats' : 'overview')
  // The project's own chats, those from its worktrees, and chats started elsewhere that worked here.
  const listId = `${project.keys.join('|')}#${project.sessionCount}`

  const loadSessions = async () => {
    const list = await window.mc.listSessions(project.keys, project.path)
    setSessions(list)
    setSelected((cur) => (cur ? list.find((x) => x.id === cur.id) ?? list[0] ?? null : list[0] ?? null))
    // Costs come per ~/.claude folder; keep only this project's chats. Codex chats have no API-priced cost.
    const keys = [...new Set(list.filter((x) => x.tool !== 'codex').map((x) => x.projectKey))]
    const ids = new Set(list.map((x) => x.id))
    const u: Record<string, UsageTotals> = keys.length ? await window.mc.sessionUsage(keys).catch(() => ({})) : {}
    setUsage(Object.fromEntries(Object.entries(u).filter(([id]) => ids.has(id))))
  }

  // Codex chats aren't in project.keys or sessionCount (those come from ~/.claude), so the list is
  // always read, and read again when the page comes back into view.
  useEffect(() => {
    // The hidden project pane should not parse its newest transcript during app startup.
    if (!visible) return
    setLoading(!sessions.length)
    loadSessions().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, visible])

  useEffect(() => {
    if (!focus) return
    const s = sessions.find((x) => x.id === focus.sessionId)
    if (s) {
      setSelected(s)
      setTab('chats')
      setFilter('')
    }
  }, [focus, sessions])

  const projectCost = Object.values(usage).reduce((t, u) => t + u.cost, 0)

  const q = filter.trim().toLowerCase()
  const visibleSessions = q
    ? sessions.filter((s) => s.title.toLowerCase().includes(q) || s.firstPrompt.toLowerCase().includes(q) || !!s.worktree?.includes(q))
    : sessions

  const base = { cwd: project.path, projectName: project.name, projectPath: project.path }
  const preferredAgent = project.meta.preferredAgent ?? 'claude'
  const chooseAgent = async (preferredAgent: AgentTool) => {
    try {
      await window.mc.setProjectMeta(project.path, { preferredAgent })
      onChanged()
    } catch (e) { toast('error', 'Could not save agent choice', errorMessage(e)) }
  }
  const newSession = () => onLaunch({ ...base, kind: preferredAgent, title: `${project.name} · new` })
  const newCodex = () => onLaunch({ ...base, kind: 'codex', title: `${project.name} · Codex` })
  const hasCodex = sessions.some((s) => s.tool === 'codex')
  const hasClaude = sessions.some((s) => s.tool !== 'codex')

  const saveTitle = async () => {
    if (!renaming) return
    const { id, draft } = renaming
    setRenaming(null)
    await window.mc.renameSession(id, draft)
    await loadSessions()
  }

  const moveTo = async (s: SessionSummary, path: string) => {
    await window.mc.moveSession(s.id, path)
    onChanged()
    await loadSessions()
  }
  const moveMenu = (s: SessionSummary) => (
    <MenuButton
      align="right"
      trigger={(toggle) => <IconButton icon={FolderInput} label="Move to another project" size={14} onClick={toggle} />}
      items={[
        ...(s.movedByYou ? [{ label: 'Automatic', hint: 'Let Mission Control decide', icon: RotateCcw, onSelect: () => moveTo(s, '') }] : []),
        ...projects
          .filter((p) => !p.worktree && p.path !== project.path)
          .slice(0, 30)
          .map((p) => ({ label: p.name, hint: p.folderName === p.name ? shortPath(p.path) : p.folderName, icon: FolderInput, onSelect: () => moveTo(s, p.path) }))
      ]}
    />
  )

  // Chats with the same title get their date, so they can be told apart.
  const titleCount = new Map<string, number>()
  for (const s of sessions) titleCount.set(s.title, (titleCount.get(s.title) ?? 0) + 1)
  const dated = (s: SessionSummary) => ((titleCount.get(s.title) ?? 0) > 1 ? new Date(s.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '')

  // Chats whose name says little: only the first prompt, a handoff name, or one several chats share.
  const unnamed = sessions.filter(
    (s) => s.firstPrompt && (s.titleSource === 'prompt' || (s.titleSource === 'claude-code' && ((titleCount.get(s.title) ?? 0) > 1 || unclearTitle(s.title))))
  )
  const nameChats = async () => {
    setNaming(true)
    try {
      const n = await window.mc.nameChats(unnamed.map((s) => s.id))
      await loadSessions()
      toast(n ? 'success' : 'info', n ? `Claude named ${n} ${n === 1 ? 'chat' : 'chats'}` : 'Nothing to name', n ? 'Names by Claude have a ✨. Rename any chat to use your own.' : undefined)
    } catch (e) {
      toast('error', 'Could not name the chats', errorMessage(e))
    } finally {
      setNaming(false)
    }
  }

  const openMany = (count: number) => {
    const list = sessions.filter((s) => !openSessions.has(s.id)).slice(0, count)
    if (!list.length) return toast('info', 'Those chats are already open', 'Find them in Agents.')
    if (list.length > 8 && !window.confirm(`Open ${list.length} chats as agents? Each one runs its own agent, and resuming a long chat re-reads it, which uses your plan.`)) return
    onOpenMany(list)
  }
  const closedCount = sessions.filter((s) => !openSessions.has(s.id)).length

  const resume = (s: SessionSummary) =>
    onLaunch({ ...base, cwd: s.cwd || project.path, title: s.title.slice(0, 48), kind: s.tool ?? 'claude', args: resumeArgs(s.tool ?? 'claude', s.id) })

  // Keyboard: tabs, the chat list and the name dialog (see shortcuts.ts).
  useShortcutEvent(
    ['tabOverview', 'tabChats', 'tabChanges', 'tabDocs', 'nameIcon', 'chatFilter', 'chatNext', 'chatPrev', 'chatResume', 'chatRename'],
    (id) => {
      const step = (d: number) => {
        setTab('chats')
        const list = visibleSessions
        if (!list.length) return
        const i = list.findIndex((x) => x.id === selected?.id)
        const next = list[Math.min(list.length - 1, Math.max(0, i + d))]
        setSelected(next)
        document.querySelector(`[data-session="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
      }
      if (id === 'tabOverview') setTab('overview')
      else if (id === 'tabChats') setTab('chats')
      else if (id === 'tabChanges' && git?.isRepo) setTab('changes')
      else if (id === 'tabDocs') setTab('docs')
      else if (id === 'nameIcon') setIdentityOpen(true)
      else if (id === 'chatFilter') {
        setTab('chats')
        setTimeout(() => filterRef.current?.focus(), 0)
      } else if (id === 'chatNext') step(1)
      else if (id === 'chatPrev') step(-1)
      else if (id === 'chatResume' && selected) resume(selected)
      else if (id === 'chatRename' && selected) {
        setTab('chats')
        setRenaming({ id: selected.id, draft: selected.title })
      }
    },
    visible
  )

  return (
    <div className="project-view">
      <header className="page-head">
        <div className="page-title">
          <button className="avatar-button" title="Change name and icon" onClick={() => setIdentityOpen(true)}>
            <Avatar name={project.name} path={project.path} size={42} />
          </button>
          <div className="page-title-text">
            <h1>
              {project.name}
              {project.pinned && <Star size={14} className="pin-star" fill="currentColor" />}
              <IconButton icon={Pencil} label={withKey('Change name and icon', keyFor('nameIcon'))} size={13} className="rename-btn" onClick={() => setIdentityOpen(true)} />
            </h1>
            {project.description && <div className="page-subtitle">{project.description}</div>}
            <div className="chips">
              <span className="chip mono" title={project.path}>
                <FolderOpen size={12} /> {project.name === project.folderName ? shortPath(project.path) : project.folderName}
              </span>
              {git?.isRepo ? (
                <span className="chip">
                  <GitBranch size={12} /> {git.branch}
                </span>
              ) : (
                git &&
                !project.worktree && (
                  <button className="chip chip-accent" onClick={() => setGitInitOpen(true)} title="Make this folder a git repository, so tasks can use worktrees and you can review and merge changes">
                    <GitBranch size={12} /> Turn on git
                  </button>
                )
              )}
              {git?.isRepo && !!git.dirty && (
                <button className="chip chip-warn" onClick={() => setTab('changes')}>
                  {git.dirty} changed
                </button>
              )}
              {!!git?.ahead && (
                <span className="chip" title="Commits not pushed">
                  <ArrowUp size={12} /> {git.ahead}
                </span>
              )}
              {!!git?.behind && (
                <span className="chip" title="Commits to pull">
                  <ArrowDown size={12} /> {git.behind}
                </span>
              )}
              {projectCost > 0 && (
                <button className="chip" title="Estimated at API prices; see Overview" onClick={() => setTab('overview')}>
                  <Coins size={12} /> {formatCost(projectCost)}
                </button>
              )}
              {project.meta.group && <span className="chip">{project.meta.group}</span>}
              {project.meta.tags.map((t) => (
                <span key={t} className="chip chip-tag">
                  #{t}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="page-actions">
          <div role="group" aria-label="Agent for new sessions">
            <Segmented<AgentTool> value={preferredAgent} onChange={chooseAgent} options={[{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }]} />
          </div>
          <div className="split-btn">
            <Button variant="primary" icon={Play} onClick={newSession} title={withKey(`New ${TOOL_NAME[preferredAgent]} session`, keyFor('newSession'))}>
              New session
            </Button>
            <MenuButton
              align="right"
              trigger={(toggle) => (
                <button className="btn btn-primary btn-md split-btn-caret" onClick={toggle} aria-label="More ways to start">
                  <ChevronDown size={15} />
                </button>
              )}
              items={[
                { label: 'New Claude session', hint: 'Claude, in the project folder', icon: Play, onSelect: () => onLaunch({ ...base, kind: 'claude', title: `${project.name} · Claude` }) },
                { label: 'New Codex session', hint: 'Codex CLI, in the project folder', icon: Hexagon, onSelect: newCodex },
                {
                  label: 'Codex, continuing from Claude',
                  hint: hasClaude ? 'Reads a handoff of the latest Claude chat' : 'No Claude chat here yet',
                  icon: ArrowRightLeft,
                  disabled: !hasClaude,
                  onSelect: () => onHandOff('claude', 'codex')
                },
                {
                  label: 'Claude, continuing from Codex',
                  hint: hasCodex ? 'Reads a handoff of the latest Codex chat' : 'No Codex chat here yet',
                  icon: ArrowRightLeft,
                  disabled: !hasCodex,
                  onSelect: () => onHandOff('codex', 'claude')
                },
                {
                  label: 'New session in worktree',
                  hint: git?.isRepo ? 'Own branch, no conflicts with other agents' : 'Needs a git repository',
                  icon: GitFork,
                  disabled: !git?.isRepo || git.isWorktree,
                  onSelect: () => onLaunchWorktree(project)
                },
                {
                  label: 'New session from latest briefing',
                  hint: 'Starts by reading the last session’s handoff',
                  icon: FileText,
                  onSelect: onStartFromBriefing
                },
                {
                  label: 'Continue last Claude chat',
                  icon: RotateCcw,
                  disabled: project.sessionCount === 0,
                  onSelect: () => onLaunch({ ...base, title: `${project.name} · continued`, args: ['--continue'] })
                },
                { label: 'PowerShell', icon: Terminal, onSelect: () => onLaunch({ ...base, title: `${project.name} · shell`, kind: 'shell' }) }
              ]}
            />
          </div>
          <MenuButton align="right"
            trigger={(toggle) => <IconButton icon={MoreHorizontal} label="Project actions" onClick={toggle} />}
            items={[
              { label: 'Open in VS Code', icon: Code2, onSelect: () => window.mc.openInVSCode(project.path) },
              { label: 'Open in Explorer', icon: FolderOpen, onSelect: () => window.mc.openInExplorer(project.path) },
              { label: 'Open Claude in Windows Terminal', icon: SquareTerminal, onSelect: () => window.mc.openExternalTerminal(project.path, []) },
              { label: project.pinned ? 'Unpin project' : 'Pin project', icon: Star, onSelect: async () => { await window.mc.togglePin(project.path); onChanged() } },
              ...(project.manual ? [{ label: 'Remove from list', icon: Trash2, onSelect: async () => { await window.mc.removeProject(project.path); onChanged() } }] : [])
            ]}
          />
        </div>
      </header>

      <nav className="page-tabs">
        <button className={tab === 'briefing' ? 'active' : ''} onClick={() => setTab('briefing')}><FileText size={15} /> Briefing</button>
        <button className={tab === 'run' ? 'active' : ''} onClick={() => setTab('run')}><Terminal size={15} /> Run</button>
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')} title={withKey('Overview', keyFor('tabOverview'))}>
          <LayoutDashboard size={15} /> Overview
          {project.meta.status && <span className={`tab-count status-${project.meta.status}`}>{project.meta.status}</span>}
        </button>
        <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')} title={withKey('Chats', keyFor('tabChats'))}>
          <MessagesSquare size={15} /> Chats <span className="tab-count">{sessions.length}</span>
        </button>
        <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')} disabled={!git?.isRepo} title={git?.isRepo ? '' : 'Not a git repository'}>
          <GitBranch size={15} /> Changes {!!git?.dirty && <span className="tab-count warn">{git.dirty}</span>}
        </button>
        <button className={tab === 'docs' ? 'active' : ''} onClick={() => setTab('docs')} title={withKey('Docs', keyFor('tabDocs'))}>
          <FileText size={15} /> Docs
        </button>
      </nav>

      <div className="page-body">
        {tab === 'briefing' && <Suspense fallback={<div className="muted pad">Loading briefing…</div>}><ProjectBriefingPanel project={project} onLaunch={onLaunch} /></Suspense>}
        {tab === 'run' && <Suspense fallback={<div className="muted pad">Loading commands…</div>}><RunPanel project={project} onChanged={onChanged} onLaunch={onLaunch} /></Suspense>}
        {tab === 'chats' && (
          <div className="chats">
            <section className="session-list">
              <div className="session-tools">
                <MenuButton
                  trigger={(toggle) => (
                    <Button size="sm" icon={Layers} onClick={toggle} disabled={!closedCount} title="Resume several chats at once, side by side in Agents">
                      Open as agents
                    </Button>
                  )}
                  items={[
                    { label: 'The 2 latest chats', icon: Layers, disabled: closedCount < 1, onSelect: () => openMany(2) },
                    { label: 'The 4 latest chats', icon: Layers, disabled: closedCount < 3, onSelect: () => openMany(4) },
                    { label: 'The 8 latest chats', icon: Layers, disabled: closedCount < 5, onSelect: () => openMany(8) },
                    { label: `All ${closedCount} chats`, hint: closedCount > 8 ? 'Asks first' : undefined, icon: Layers, onSelect: () => openMany(closedCount) }
                  ]}
                />
                {unnamed.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={naming ? Loader2 : Sparkles}
                    className={naming ? 'spinning-icon' : ''}
                    disabled={naming}
                    onClick={nameChats}
                    title={`${unnamed.length} ${unnamed.length === 1 ? 'chat has a name' : 'chats have names'} that say little: only the first prompt, a handoff name like "Next task briefing", or a name other chats share. Claude (Haiku) reads the first and latest prompt, the files and the last reply of each and gives a clear name, all in one call (about $0.005). Names you give chats in Mission Control are never changed.`}
                  >
                    {naming ? 'Naming…' : `Name ${unnamed.length} ${unnamed.length === 1 ? 'chat' : 'chats'}`}
                  </Button>
                )}
              </div>
              <input
                ref={filterRef}
                className="filter"
                placeholder={`Search chats${keyFor('chatFilter') ? `  (${keyFor('chatFilter')})` : ''}`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  // Down from the search box moves into the list; Enter opens the first match.
                  if ((e.key === 'ArrowDown' || e.key === 'Enter') && visibleSessions[0]) {
                    e.preventDefault()
                    setSelected(visibleSessions[0])
                    ;(e.target as HTMLInputElement).blur()
                  }
                  if (e.key === 'Escape') setFilter('')
                }}
              />
              <ul className="scroll">
                {loading && <li className="muted pad">Loading chats…</li>}
                {!loading && sessions.length === 0 && (
                  <EmptyState icon={History} title="No chats yet">
                    Start a session and it will show up here.
                  </EmptyState>
                )}
                {!loading && sessions.length > 0 && visibleSessions.length === 0 && <li className="muted pad">No chats match.</li>}
                {visibleSessions.map((s) => (
                  <li key={s.id} data-session={s.id}>
                    <div className={`session-item ${selected?.id === s.id ? 'selected' : ''}`} onClick={() => setSelected(s)}>
                      {renaming?.id === s.id ? (
                        <input
                          className="session-title-input"
                          autoFocus
                          value={renaming.draft}
                          placeholder="Empty brings back the automatic title"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenaming({ id: s.id, draft: e.target.value })}
                          onBlur={saveTitle}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveTitle()
                            if (e.key === 'Escape') setRenaming(null)
                          }}
                        />
                      ) : (
                        <div className="session-title" title={s.firstPrompt ? `${s.title}\n\n${s.firstPrompt}` : s.title} onDoubleClick={() => setRenaming({ id: s.id, draft: s.title })}>
                          {openSessions.has(s.id) && <span className="session-open" title="Open as an agent" />}
                          <ToolBadge tool={s.tool ?? 'claude'} />
                          <span className="ellipsis">{s.title}</span>
                          {dated(s) && <span className="session-date">{dated(s)}</span>}
                          {s.titleSource === 'claude' && <Sparkles size={11} className="named-by-claude" aria-label="Named by Claude" />}
                        </div>
                      )}
                      {s.lastPrompt && renaming?.id !== s.id && (
                        <div className="session-last ellipsis" title={s.lastPrompt}>
                          Latest: {s.lastPrompt}
                        </div>
                      )}
                      <div className="session-meta">
                        <span>{timeAgo(s.updatedAt)}</span>
                        <span className="meta-sep">·</span>
                        {usage[s.id] ? <span title="Estimated at API prices">{formatCost(usage[s.id].cost)}</span> : <span>{formatBytes(s.sizeBytes)}</span>}
                        {usage[s.id] && <PlanShare usd={usage[s.id].cost} prefix=" " className="muted" />}
                        {s.movedFrom && (
                          <>
                            <span className="meta-sep">·</span>
                            <span className="session-worktree" title={s.movedByYou ? 'You moved this chat here' : `Started in ${s.movedFrom}, but worked in this project`}>
                              <FolderInput size={10} /> from {s.movedFrom}
                            </span>
                          </>
                        )}
                        {s.worktree ? (
                          <>
                            <span className="meta-sep">·</span>
                            <span className="session-worktree ellipsis" title="Ran in a worktree of this project">
                              <GitFork size={10} /> {s.worktree}
                            </span>
                          </>
                        ) : (
                          s.gitBranch && (
                            <>
                              <span className="meta-sep">·</span>
                              <GitBranch size={10} /> <span className="ellipsis">{s.gitBranch}</span>
                            </>
                          )
                        )}
                      </div>
                      <button
                        className="session-rename"
                        title="Rename chat (or double-click its title)"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenaming({ id: s.id, draft: s.title })
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="session-resume"
                        title="Resume in a new agent"
                        onClick={(e) => {
                          e.stopPropagation()
                          resume(s)
                        }}
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="chat-pane">
              {selected ? (
                <SessionViewer
                  session={selected}
                  onResume={() => resume(selected)}
                  actions={
                    <>
                      <Button
                        size="sm"
                        icon={ArrowRightLeft}
                        title={`Start ${TOOL_NAME[otherTool(selected.tool ?? 'claude')]} with a handoff of this chat: what was asked, what changed, git and the rules`}
                        onClick={() => onHandOff(selected.tool ?? 'claude', otherTool(selected.tool ?? 'claude'), selected.id)}
                      >
                        Continue in {TOOL_NAME[otherTool(selected.tool ?? 'claude')]}
                      </Button>
                      {moveMenu(selected)}
                    </>
                  }
                  onTitleChanged={() => void loadSessions()}
                />
              ) : (
                <EmptyState icon={MessagesSquare} title="Pick a chat">
                  Its full conversation shows here.
                </EmptyState>
              )}
            </section>
          </div>
        )}
        {tab === 'overview' && (
          <OverviewPanel project={project} groups={groups} usage={usage} budget={budget} isRepo={!!git?.isRepo} onTurnOnGit={() => setGitInitOpen(true)} onChanged={onChanged} />
        )}
        {identityOpen && <IdentityDialog project={project} onClose={() => setIdentityOpen(false)} onSaved={onChanged} />}
        {gitInitOpen && (
          <GitInitDialog
            project={project}
            onClose={() => setGitInitOpen(false)}
            onDone={() => {
              setGitInitOpen(false)
              onChanged()
            }}
          />
        )}
        {tab === 'changes' && git?.isRepo && <ChangesPanel path={project.path} visible={visible && tab === 'changes'} onChanged={onChanged} />}
        {tab === 'docs' && (
          <Suspense fallback={null}>
            <VaultView project={project} onChanged={onChanged} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
