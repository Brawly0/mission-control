import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Coins,
  LayoutDashboard,
  Code2,
  FileText,
  FolderOpen,
  GitBranch,
  GitFork,
  History,
  MessagesSquare,
  Play,
  RotateCcw,
  SquareTerminal,
  Star,
  Terminal,
  Trash2
} from 'lucide-react'
import type { BudgetState, GitInfo, Project, SessionSummary, UsageTotals } from '@shared/types'
import type { LaunchOptions } from '../types'
import { formatBytes, formatCost, shortPath, timeAgo } from '../util'
import SessionViewer from './SessionViewer'
import DocsPanel from './DocsPanel'
import ChangesPanel from './ChangesPanel'
import OverviewPanel from './OverviewPanel'
import GitInitDialog from './GitInitDialog'
import { Avatar, Button, EmptyState, IconButton, MenuButton } from './ui'

interface Props {
  project: Project
  git?: GitInfo
  visible: boolean
  groups: string[]
  /** A chat to show, e.g. one picked in search; the nonce re-triggers the same chat. */
  focus?: { sessionId: string; nonce: number }
  onLaunch: (opts: LaunchOptions) => void
  onLaunchWorktree: (project: Project) => void
  budget?: BudgetState
  onChanged: () => void
}

type Tab = 'overview' | 'chats' | 'changes' | 'docs'

export default function ProjectView({ project, git, visible, groups, focus, budget, onLaunch, onLaunchWorktree, onChanged }: Props) {
  const [gitInitOpen, setGitInitOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [usage, setUsage] = useState<Record<string, UsageTotals>>({})
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  const [tab, setTab] = useState<Tab>(project.key ? 'chats' : 'overview')

  useEffect(() => {
    if (!project.key) {
      setSessions([])
      setUsage({})
      return
    }
    setLoading(true)
    window.mc
      .listSessions(project.key)
      .then((list) => {
        setSessions(list)
        setSelected((cur) => cur ?? list[0] ?? null)
      })
      .finally(() => setLoading(false))
    window.mc.sessionUsage(project.key).then(setUsage).catch(() => setUsage({}))
  }, [project.key])

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
    ? sessions.filter((s) => s.title.toLowerCase().includes(q) || s.firstPrompt.toLowerCase().includes(q))
    : sessions

  const base = { cwd: project.path, projectName: project.name, projectPath: project.path }
  const newSession = () => onLaunch({ ...base, title: `${project.name} · new` })
  const resume = (s: SessionSummary) =>
    onLaunch({ ...base, cwd: s.cwd || project.path, title: s.title.slice(0, 48), args: ['--resume', s.id] })

  return (
    <div className="project-view">
      <header className="page-head">
        <div className="page-title">
          <Avatar name={project.name} size={42} />
          <div className="page-title-text">
            <h1>
              {project.name}
              {project.pinned && <Star size={14} className="pin-star" fill="currentColor" />}
            </h1>
            <div className="chips">
              <span className="chip mono" title={project.path}>
                <FolderOpen size={12} /> {shortPath(project.path)}
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
          <div className="split-btn">
            <Button variant="primary" icon={Play} onClick={newSession}>
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
                { label: 'New session', hint: 'In the project folder', icon: Play, onSelect: newSession },
                {
                  label: 'New session in worktree',
                  hint: git?.isRepo ? 'Own branch, no conflicts with other agents' : 'Needs a git repository',
                  icon: GitFork,
                  disabled: !git?.isRepo || git.isWorktree,
                  onSelect: () => onLaunchWorktree(project)
                },
                {
                  label: 'Continue last chat',
                  icon: RotateCcw,
                  disabled: project.sessionCount === 0,
                  onSelect: () => onLaunch({ ...base, title: `${project.name} · continued`, args: ['--continue'] })
                },
                { label: 'PowerShell', icon: Terminal, onSelect: () => onLaunch({ ...base, title: `${project.name} · shell`, kind: 'shell' }) }
              ]}
            />
          </div>
          <div className="icon-group">
            <IconButton icon={SquareTerminal} label="Open Claude in Windows Terminal" onClick={() => window.mc.openExternalTerminal(project.path, [])} />
            <IconButton icon={Code2} label="Open in VS Code" onClick={() => window.mc.openInVSCode(project.path)} />
            <IconButton icon={FolderOpen} label="Open in Explorer" onClick={() => window.mc.openInExplorer(project.path)} />
            <IconButton
              icon={Star}
              label={project.pinned ? 'Unpin' : 'Pin'}
              active={project.pinned}
              onClick={async () => {
                await window.mc.togglePin(project.path)
                onChanged()
              }}
            />
            {project.manual && (
              <IconButton
                icon={Trash2}
                label="Remove from list"
                onClick={async () => {
                  await window.mc.removeProject(project.path)
                  onChanged()
                }}
              />
            )}
          </div>
        </div>
      </header>

      <nav className="page-tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          <LayoutDashboard size={15} /> Overview
          {project.meta.status && <span className={`tab-count status-${project.meta.status}`}>{project.meta.status}</span>}
        </button>
        <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>
          <MessagesSquare size={15} /> Chats <span className="tab-count">{sessions.length}</span>
        </button>
        <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')} disabled={!git?.isRepo} title={git?.isRepo ? '' : 'Not a git repository'}>
          <GitBranch size={15} /> Changes {!!git?.dirty && <span className="tab-count warn">{git.dirty}</span>}
        </button>
        <button className={tab === 'docs' ? 'active' : ''} onClick={() => setTab('docs')}>
          <FileText size={15} /> Docs
        </button>
      </nav>

      <div className="page-body">
        {tab === 'chats' && (
          <div className="chats">
            <section className="session-list">
              <input className="filter" placeholder="Search chats" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <ul className="scroll">
                {loading && <li className="muted pad">Loading chats…</li>}
                {!loading && sessions.length === 0 && (
                  <EmptyState icon={History} title="No chats yet">
                    Start a session and it will show up here.
                  </EmptyState>
                )}
                {!loading && sessions.length > 0 && visibleSessions.length === 0 && <li className="muted pad">No chats match.</li>}
                {visibleSessions.map((s) => (
                  <li key={s.id}>
                    <div className={`session-item ${selected?.id === s.id ? 'selected' : ''}`} onClick={() => setSelected(s)}>
                      <div className="session-title">{s.title}</div>
                      <div className="session-meta">
                        <span>{timeAgo(s.updatedAt)}</span>
                        <span className="meta-sep">·</span>
                        {usage[s.id] ? <span title="Estimated at API prices">{formatCost(usage[s.id].cost)}</span> : <span>{formatBytes(s.sizeBytes)}</span>}
                        {s.gitBranch && (
                          <>
                            <span className="meta-sep">·</span>
                            <GitBranch size={10} /> <span className="ellipsis">{s.gitBranch}</span>
                          </>
                        )}
                      </div>
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
                <SessionViewer session={selected} onResume={() => resume(selected)} />
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
        {tab === 'docs' && <DocsPanel projectPath={project.path} />}
      </div>
    </div>
  )
}
