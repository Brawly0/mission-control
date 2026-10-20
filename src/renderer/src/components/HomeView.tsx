import { useEffect, useState } from 'react'
import { ArrowRight, Bot, CircleAlert, CircleCheck, FolderGit2, GitBranch, History, Play, Sparkles } from 'lucide-react'
import type { Project, RecentSession } from '@shared/types'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { elapsed, timeAgo } from '../util'
import { Avatar, Button, EmptyState } from './ui'

interface Props {
  agents: Agent[]
  lastOutput: Record<string, number>
  projects: Project[]
  visible: boolean
  onOpenAgent: (id: string) => void
  onOpenProject: (path: string) => void
  onResume: (s: RecentSession) => void
  onNewSession: (p: Project) => void
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function HomeView({ agents, lastOutput, projects, visible, onOpenAgent, onOpenProject, onResume, onNewSession }: Props) {
  const [recent, setRecent] = useState<RecentSession[] | null>(null)

  useEffect(() => {
    if (!visible) return
    window.mc.recentSessions(8).then(setRecent)
  }, [visible])

  const live = agents.filter((a) => !a.exited)
  const needYou = live.filter((a) => a.hookStatus === 'needs-input')
  const done = live.filter((a) => a.hookStatus === 'done')
  const working = live.filter((a) => displayStatus(a, lastOutput[a.id]).cls === 'working')
  const topProjects = projects.filter((p) => !p.worktree).slice(0, 6)

  const summary =
    live.length === 0
      ? 'No agents running. Start one from a project below.'
      : [
          `${live.length} ${live.length === 1 ? 'agent' : 'agents'} running`,
          needYou.length ? `${needYou.length} ${needYou.length === 1 ? 'needs' : 'need'} you` : '',
          done.length ? `${done.length} waiting for your next prompt` : ''
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className="home scroll">
      <header className="home-hero">
        <div>
          <h1>{greeting()}</h1>
          <p className="muted">{summary}</p>
        </div>
      </header>

      <section className="stat-row">
        <div className="stat">
          <Bot size={18} className="stat-icon tone-green" />
          <div className="stat-value">{working.length}</div>
          <div className="stat-label">Working</div>
        </div>
        <div className="stat">
          <CircleAlert size={18} className="stat-icon tone-orange" />
          <div className="stat-value">{needYou.length}</div>
          <div className="stat-label">Need you</div>
        </div>
        <div className="stat">
          <CircleCheck size={18} className="stat-icon tone-blue" />
          <div className="stat-value">{done.length}</div>
          <div className="stat-label">Your turn</div>
        </div>
        <div className="stat">
          <FolderGit2 size={18} className="stat-icon tone-accent" />
          <div className="stat-value">{projects.filter((p) => !p.worktree).length}</div>
          <div className="stat-label">Projects</div>
        </div>
      </section>

      {live.length > 0 && (
        <section className="home-section">
          <div className="home-section-head">
            <h2>Agents</h2>
          </div>
          <div className="agent-cards">
            {[...needYou, ...live.filter((a) => a.hookStatus !== 'needs-input')].map((a) => {
              const st = displayStatus(a, lastOutput[a.id])
              return (
                <button key={a.id} className={`agent-card status-${st.cls}`} onClick={() => onOpenAgent(a.id)}>
                  <div className="agent-card-top">
                    <Avatar name={a.projectName} path={a.projectPath} size={26} />
                    <div className="agent-card-title">
                      <div className="ellipsis">{a.title}</div>
                      <div className="muted small ellipsis">
                        {a.worktree ? (
                          <>
                            <GitBranch size={11} /> {a.worktree.branch}
                          </>
                        ) : (
                          a.projectName
                        )}
                      </div>
                    </div>
                    <span className="muted small">{elapsed(a.startedAt)}</span>
                  </div>
                  <div className="agent-card-status">
                    <span className={`dot ${st.cls}`} />
                    <span className="ellipsis">{st.label}</span>
                    <ArrowRight size={14} className="agent-card-go" />
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="home-columns">
        <section className="home-section">
          <div className="home-section-head">
            <h2>
              <History size={15} /> Recent chats
            </h2>
          </div>
          <div className="card list-card">
            {recent === null && <div className="muted pad">Loading…</div>}
            {recent?.length === 0 && <EmptyState icon={Sparkles} title="No chats yet" />}
            {recent?.map((s) => (
              <div key={s.id} className="recent-row">
                <Avatar name={s.projectName} path={s.projectPath} size={26} />
                <button className="recent-main" onClick={() => onOpenProject(s.projectPath)}>
                  <div className="ellipsis">{s.title}</div>
                  <div className="muted small">
                    {s.projectName} · {timeAgo(s.updatedAt)}
                  </div>
                </button>
                <Button size="sm" variant="ghost" icon={Play} onClick={() => onResume(s)}>
                  Resume
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2>
              <FolderGit2 size={15} /> Jump back in
            </h2>
          </div>
          <div className="project-tiles">
            {topProjects.map((p) => (
              <div key={p.path} className="project-tile">
                <button className="project-tile-main" onClick={() => onOpenProject(p.path)}>
                  <Avatar name={p.name} path={p.path} size={34} />
                  <div className="project-tile-text">
                    <div className="ellipsis strong">{p.name}</div>
                    <div className="muted small">
                      {p.sessionCount} {p.sessionCount === 1 ? 'chat' : 'chats'} · {timeAgo(p.lastActivity)}
                    </div>
                  </div>
                </button>
                <Button size="sm" variant="secondary" icon={Play} onClick={() => onNewSession(p)} title="New Claude session">
                  New
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
