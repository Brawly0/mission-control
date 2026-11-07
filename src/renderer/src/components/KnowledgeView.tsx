import { useEffect, useMemo, useState } from 'react'
import { BookOpen, FileText, RefreshCw, Search } from 'lucide-react'
import type { KnowledgeDoc, KnowledgeHit } from '@shared/types'
import { formatBytes, timeAgo } from '../util'
import DocViewer from './DocViewer'
import { Avatar, EmptyState, IconButton, Segmented } from './ui'
import { BriefingDetail, BriefingList, useBriefings } from './BriefingsPane'

/** Every CLAUDE.md, README and docs/ file across your projects, searchable, readable and editable in one place. */
export default function KnowledgeView({ visible, onStartFromBriefing }: { visible: boolean; onStartFromBriefing: (projectPath: string, file: string) => void }) {
  const [tab, setTab] = useState<'docs' | 'briefings'>('docs')
  const briefings = useBriefings(visible && tab === 'briefings')
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [current, setCurrent] = useState<KnowledgeDoc | null>(null)

  const load = () => window.mc.knowledgeDocs().then((d) => {
    setDocs(d)
    setCurrent((cur) => cur ?? d[0] ?? null)
  })
  useEffect(() => {
    if (visible && docs === null) void load()
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = query.trim()
    if (!q || tab !== 'docs') return setHits(null)
    const timer = setTimeout(() => window.mc.searchKnowledge(q).then(setHits).catch(() => setHits([])), 200)
    return () => clearTimeout(timer)
  }, [query, tab])

  const byProject = useMemo(() => {
    const map = new Map<string, KnowledgeDoc[]>()
    for (const d of docs ?? []) map.set(d.projectPath, [...(map.get(d.projectPath) ?? []), d])
    return [...map.entries()]
  }, [docs])

  const row = (d: KnowledgeDoc, snippets?: KnowledgeHit['snippets']) => (
    <li key={d.path}>
      <button className={`kn-doc ${current?.path === d.path ? 'selected' : ''}`} onClick={() => setCurrent(d)} title={d.path}>
        <FileText size={14} />
        <span className="kn-doc-text">
          <span className="ellipsis">{d.title || d.name}</span>
          <span className="muted tiny ellipsis">
            {d.title ? `${d.name} · ` : ''}
            {formatBytes(d.size)} · {timeAgo(d.mtime)}
          </span>
          {snippets?.map((s) => (
            <span key={s.line} className="kn-snippet ellipsis" data-no-brand>
              {s.line}: {s.text}
            </span>
          ))}
        </span>
      </button>
    </li>
  )

  return (
    <div className="knowledge">
      <aside className="kn-list">
        <div className="kn-head">
          <h1>
            <BookOpen size={18} /> Knowledge
          </h1>
          <IconButton icon={RefreshCw} label="Look for new docs" size={14} onClick={() => void load()} />
        </div>
        <Segmented
          value={tab}
          options={[
            { value: 'docs', label: 'Docs' },
            { value: 'briefings', label: 'Session briefings' }
          ]}
          onChange={setTab}
        />
        <div className="toolbar-search">
          <Search size={14} />
          <input placeholder={tab === 'docs' ? 'Search all docs' : 'Search briefings'} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        </div>
        {tab === 'briefings' ? (
          <BriefingList state={briefings} query={query} />
        ) : (
        <div className="kn-scroll scroll">
          {docs === null && <div className="muted pad">Looking through your projects…</div>}
          {hits ? (
            hits.length === 0 ? (
              <div className="muted pad">No docs mention “{query}”.</div>
            ) : (
              <ul>
                {hits.map((h) => (
                  <div key={h.doc.path}>
                    <div className="kn-project small muted">{h.doc.projectName}</div>
                    {row(h.doc, h.snippets)}
                  </div>
                ))}
              </ul>
            )
          ) : (
            byProject.map(([path, list]) => (
              <section key={path} className="kn-group">
                <div className="kn-project">
                  <Avatar name={list[0].projectName} path={path} size={18} />
                  <span className="strong small ellipsis">{list[0].projectName}</span>
                  <span className="muted tiny">{list.length}</span>
                </div>
                <ul>{list.map((d) => row(d))}</ul>
              </section>
            ))
          )}
        </div>
        )}
      </aside>
      <section className="kn-view">
        {tab === 'briefings' ? (
          <BriefingDetail state={briefings} onStartFromBriefing={onStartFromBriefing} />
        ) : (
        <>
        {current ? (
          <DocViewer key={current.path} doc={current} subtitle={current.projectName} />
        ) : (
          docs && (
            <EmptyState icon={BookOpen} title="No docs yet">
              Add a CLAUDE.md or README.md to a project and it shows here.
            </EmptyState>
          )
        )}
        </>
        )}
      </section>
    </div>
  )
}
