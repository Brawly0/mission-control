import { useEffect, useState } from 'react'
import type { Project, SessionSummary } from '@shared/types'
import type { LaunchOptions } from '../types'
import { formatBytes, timeAgo } from '../util'
import SessionViewer from './SessionViewer'
import DocsPanel from './DocsPanel'

interface Props {
  project: Project
  onLaunch: (opts: LaunchOptions) => void
  onChanged: () => void
}

type RightTab = 'chat' | 'docs'

export default function ProjectView({ project, onLaunch, onChanged }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  const [tab, setTab] = useState<RightTab>('chat')

  useEffect(() => {
    if (!project.key) {
      setSessions([])
      setTab('docs')
      return
    }
    setLoading(true)
    window.mc
      .listSessions(project.key)
      .then(setSessions)
      .finally(() => setLoading(false))
  }, [project.key])

  const q = filter.trim().toLowerCase()
  const visible = q
    ? sessions.filter((s) => s.title.toLowerCase().includes(q) || s.firstPrompt.toLowerCase().includes(q))
    : sessions

  const resume = (s: SessionSummary) =>
    onLaunch({
      cwd: s.cwd || project.path,
      projectName: project.name,
      title: `${project.name} · ${s.title.slice(0, 40)}`,
      args: ['--resume', s.id]
    })

  return (
    <div className="project-view">
      <section className="project-header">
        <div>
          <h1>{project.name}</h1>
          <div className="muted mono">{project.path}</div>
        </div>
        <div className="toolbar">
          <button
            className="btn primary"
            onClick={() => onLaunch({ cwd: project.path, projectName: project.name, title: `${project.name} · new` })}
          >
            ▶ New Claude session
          </button>
          <button
            className="btn"
            onClick={() =>
              onLaunch({ cwd: project.path, projectName: project.name, title: `${project.name} · continue`, args: ['--continue'] })
            }
            disabled={project.sessionCount === 0}
          >
            Continue last
          </button>
          <button
            className="btn"
            onClick={() =>
              onLaunch({ cwd: project.path, projectName: project.name, title: `${project.name} · shell`, kind: 'shell' })
            }
          >
            Shell
          </button>
          <button className="btn" onClick={() => window.mc.openExternalTerminal(project.path, [])}>
            Windows Terminal
          </button>
          <button className="btn" onClick={() => window.mc.openInVSCode(project.path)}>
            VS Code
          </button>
          <button className="btn" onClick={() => window.mc.openInExplorer(project.path)}>
            Explorer
          </button>
          <button
            className="btn"
            onClick={async () => {
              await window.mc.togglePin(project.path)
              onChanged()
            }}
          >
            {project.pinned ? '★ Unpin' : '☆ Pin'}
          </button>
          {project.manual && (
            <button
              className="btn danger"
              onClick={async () => {
                await window.mc.removeProject(project.path)
                onChanged()
              }}
            >
              Remove
            </button>
          )}
        </div>
      </section>

      <div className="project-body">
        <section className="session-list">
          <div className="panel-header">
            <span>Chats ({sessions.length})</span>
          </div>
          <input
            className="search"
            placeholder="Search chats…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul>
            {loading && <li className="muted pad">Loading chats…</li>}
            {!loading && visible.length === 0 && <li className="muted pad">No chats found.</li>}
            {visible.map((s) => (
              <li key={s.id}>
                <div
                  className={`session-item ${selected?.id === s.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelected(s)
                    setTab('chat')
                  }}
                >
                  <div className="session-title">{s.title}</div>
                  <div className="session-meta">
                    {timeAgo(s.updatedAt)} · {formatBytes(s.sizeBytes)}
                    {s.gitBranch && ` · ${s.gitBranch}`}
                  </div>
                  <button
                    className="btn small"
                    onClick={(e) => {
                      e.stopPropagation()
                      resume(s)
                    }}
                  >
                    Resume
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="detail">
          <div className="tabs">
            <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
              Chat
            </button>
            <button className={tab === 'docs' ? 'active' : ''} onClick={() => setTab('docs')}>
              Docs
            </button>
          </div>
          <div className="detail-body">
            {tab === 'chat' ? (
              selected ? (
                <SessionViewer session={selected} onResume={() => resume(selected)} />
              ) : (
                <div className="empty">Pick a chat on the left to read it here.</div>
              )
            ) : (
              <DocsPanel projectPath={project.path} />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
