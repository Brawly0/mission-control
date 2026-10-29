import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Play, RefreshCw, TextSearch } from 'lucide-react'
import type { IndexStatus, Project, SearchHit } from '@shared/types'
import { basename, errorMessage, timeAgo } from '../util'
import { Avatar, Button, EmptyState, IconButton, LoadingState, Segmented, ToolBadge } from './ui'
import { useLook } from '../projectLook'

interface Props {
  visible: boolean
  projects: Project[]
  status: IndexStatus | null
  onOpen: (projectPath: string, sessionId: string) => void
  onResume: (hit: SearchHit) => void
}

type Role = 'all' | 'user' | 'assistant'

/** Renders a snippet whose matches are wrapped in \u0001 … \u0002, without Markdown's bold, code and heading marks. */
function Snippet({ text }: { text: string }) {
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\n)#{1,6} /g, '$1')
  const parts = plain.replace(/\s+/g, ' ').split(/(\u0001[^\u0002]*\u0002)/)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? <mark key={i}>{p.slice(1, -1)}</mark> : <Fragment key={i}>{p}</Fragment>
      )}
    </>
  )
}

export default function SearchView({ visible, projects, status, onOpen, onResume }: Props) {
  const look = useLook()
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role>('all')
  const [projectKey, setProjectKey] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  useEffect(() => {
    const q = query.trim()
    setError(null)
    setHits(null)
    if (!q) {
      setLoading(false)
      return
    }
    let current = true
    setLoading(true)
    const timer = setTimeout(() => {
      window.mc
        .search(q, { role: role === 'all' ? undefined : role, projectKey: projects.find((p) => p.path === projectKey)?.keys ?? (projectKey || undefined), projectPath: projectKey || undefined, limit: 150 })
        .then((h) => {
          if (current) setHits(h)
        })
        .catch((e) => { if (current) setError(errorMessage(e)) })
        .finally(() => { if (current) setLoading(false) })
    }, 180)
    return () => { current = false; clearTimeout(timer) }
  }, [query, role, projectKey, status?.lastRun])

  // Group matches by chat, keeping the best-ranked chat first.
  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const h of hits ?? []) map.set(h.sessionId, [...(map.get(h.sessionId) ?? []), h])
    return [...map.values()]
  }, [hits])

  const indexedProjects = projects.filter((p) => !p.worktree)

  return (
    <div className="search-view">
      <header className="search-head">
        <div className="search-box">
          <TextSearch size={18} />
          <input
            ref={inputRef}
            placeholder="Search prompts and replies across Claude and Codex…"
            aria-label="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
        </div>
        <div className="search-filters">
          <Segmented<Role>
            value={role}
            onChange={setRole}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'user', label: 'My prompts' },
              { value: 'assistant', label: 'Agent replies' }
            ]}
          />
          <select className="select" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {indexedProjects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="search-meta muted small">
            {status?.indexing
              ? `Indexing ${status.done}/${status.total} files…`
              : status
                ? `${status.messages.toLocaleString()} messages in ${status.sessions} chats`
                : ''}
          </span>
          <IconButton icon={RefreshCw} label="Re-scan chats now" size={14} onClick={() => window.mc.reindex()} className={status?.indexing ? 'spinning' : ''} />
        </div>
      </header>

      <div className="search-results scroll" aria-busy={loading}>
        {error && <div className="error pad">{error}</div>}
        {loading && <LoadingState>Searching chats…</LoadingState>}
        {hits === null && !error && !loading && (
          <EmptyState icon={TextSearch} title="Search all your chats">
            <p>Find a prompt or reply across your projects. Try words you remember, or start with an example below.</p>
            <div className="search-examples" role="group" aria-label="Example searches">
              {['fix tests', 'deployment', 'explain code', 'database migration'].map((example) => (
                <Button key={example} variant="secondary" onClick={() => { setQuery(example); inputRef.current?.focus() }}>{example}</Button>
              ))}
            </div>
            <p className="small muted">Suggestions may not match your chats. All words must match; the last word also matches as a prefix.</p>
          </EmptyState>
        )}
        {hits !== null && grouped.length === 0 && !error && (
          <EmptyState icon={TextSearch} title="No matches">
            Try fewer or different words{role !== 'all' || projectKey ? ', or clear the filters' : ''}.
          </EmptyState>
        )}
        {grouped.map((group) => {
          const first = group[0]
          const name = look(first.projectPath)?.name ?? (basename(first.projectPath) || 'Unknown project')
          return (
            <article key={first.sessionId} className="result card">
              <div className="result-head">
                <Avatar name={name} path={first.projectPath} size={26} />
                <button className="result-title" onClick={() => onOpen(first.projectPath, first.sessionId)}>
                  <div className="ellipsis strong"><ToolBadge tool={first.projectKey === 'codex' ? 'codex' : 'claude'} /> {first.title}</div>
                  <div className="muted small">
                    {name}
                    {first.timestamp > 0 && ` · ${timeAgo(first.timestamp)}`} · {group.length} {group.length === 1 ? 'match' : 'matches'}
                  </div>
                </button>
                <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => onOpen(first.projectPath, first.sessionId)}>
                  Open
                </Button>
                <Button size="sm" variant="secondary" icon={Play} onClick={() => onResume(first)}>
                  Resume
                </Button>
              </div>
              <ul className="result-snippets">
                {group.slice(0, 3).map((h, i) => (
                  <li key={i}>
                    <span className={`who who-${h.role}`}>{h.role === 'user' ? 'You' : h.projectKey === 'codex' ? 'Codex' : 'Claude'}</span>
                    <span className="snippet">
                      <Snippet text={h.snippet} />
                    </span>
                  </li>
                ))}
              </ul>
              {group.length > 3 && <div className="muted small more-matches">+{group.length - 3} more in this chat</div>}
            </article>
          )
        })}
      </div>
    </div>
  )
}
