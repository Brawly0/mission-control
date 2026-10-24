import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FileText,
  FolderOpen,
  Link2,
  ListTree,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import type { Project, RateLimitInfo, Task, VaultInfo, VaultNote } from '@shared/types'
import { headings, parseFrontmatter, resolveLink } from '@shared/vault'
import { errorMessage, formatCost, timeAgo } from '../util'
import { useToast } from '../toast'
import DocViewer from './DocViewer'
import VaultGraph from './VaultGraph'
import { Button, IconButton, Segmented } from './ui'
import { PlanShare } from '../planRate'

interface Props {
  project: Project
  onChanged: () => void
}

const VAULT_TASK = 'Docs vault: '
/** Notes Claude writes when it builds a vault, shown before you start it. */
const PLANNED = [
  ['INDEX', 'the hub: what the project is and a map of every note'],
  ['overview', 'purpose, features, tech stack'],
  ['architecture', 'modules, files and how they fit together'],
  ['setup', 'install, run, build, test, release'],
  ['conventions', 'style, patterns, rules and gotchas'],
  ['status', 'done, in progress, problems, next steps'],
  ['decisions/', 'why things are the way they are']
]

function folderLabel(folder: string): string {
  return folder ? folder.split('/').pop()! : 'Project root'
}

/** Notes first by what a reader wants: the hub, then Claude's notes, then by title. */
function sortNotes(a: VaultNote, b: VaultNote): number {
  const rank = (n: VaultNote) => (/^index$/i.test(n.name) ? 0 : n.rel === 'CLAUDE.md' ? 1 : n.rel === 'README.md' ? 2 : 3)
  return rank(a) - rank(b) || a.title.localeCompare(b.title)
}

/** A project's docs as an Obsidian-style vault: notes, links, backlinks, outline and graph; Claude builds and updates it. */
export default function VaultView({ project, onChanged }: Props) {
  const toast = useToast()
  const [info, setInfo] = useState<VaultInfo | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [history, setHistory] = useState<{ stack: string[]; at: number }>({ stack: [], at: -1 })
  const [filter, setFilter] = useState('')
  const [mode, setMode] = useState<'notes' | 'graph'>('notes')
  const [content, setContent] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['docs/briefings']))
  const [task, setTask] = useState<Task | null>(null)
  const [buildOpen, setBuildOpen] = useState(false)
  const [newName, setNewName] = useState<string | null>(null)

  const load = useCallback(() => {
    window.mc
      .vaultNotes(project.path)
      .then(setInfo)
      .catch(() => setInfo({ projectPath: project.path, notes: [], hasIndex: false, claudeMdLinked: false, updatedAt: 0 }))
  }, [project.path])

  // Load, and follow changes on disk while this tab is open (Claude writing notes shows up live).
  useEffect(() => {
    setInfo(null)
    setCurrent(null)
    setHistory({ stack: [], at: -1 })
    load()
    window.mc.watchVault(project.path)
    const off = window.mc.onVaultChanged((p) => p === project.path && load())
    return () => {
      off()
      window.mc.watchVault(null)
    }
  }, [project.path, load])

  // The latest vault task for this project, live.
  useEffect(() => {
    const pick = (list: Task[]) =>
      setTask(list.filter((t) => t.projectPath === project.path && t.title.startsWith(VAULT_TASK)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null)
    window.mc.listTasks().then(pick)
    return window.mc.onTasksChanged(pick)
  }, [project.path])
  const running = task?.column === 'running'
  useEffect(() => {
    if (task && !running) load()
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  const notes = useMemo(() => [...(info?.notes ?? [])].sort(sortNotes), [info])
  const byRel = useMemo(() => new Map(notes.map((n) => [n.rel, n])), [notes])
  const rels = useMemo(() => notes.map((n) => n.rel), [notes])

  // Open the hub when the vault loads; without one, the middle explains the vault and offers to build it.
  useEffect(() => {
    if (!info || (current && byRel.has(current))) return
    const hub = notes.find((n) => n.rel.toLowerCase() === 'docs/index.md')
    if (hub) open(hub.rel)
    else setCurrent(null)
  }, [info]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (rel: string) => {
    setMode('notes')
    setCurrent(rel)
    setHistory((h) => {
      if (h.stack[h.at] === rel) return h
      const stack = [...h.stack.slice(0, h.at + 1), rel]
      return { stack, at: stack.length - 1 }
    })
  }
  const go = (delta: number) => {
    const at = history.at + delta
    if (at < 0 || at >= history.stack.length) return
    setHistory({ ...history, at })
    setCurrent(history.stack[at])
    setMode('notes')
  }

  const note = current ? byRel.get(current) : undefined
  const link = (target: string) => {
    const hit = note && resolveLink(target, note.rel, rels)
    if (hit) open(hit)
  }
  const exists = (target: string) => !!note && !!resolveLink(target, note.rel, rels)
  const backlinks = useMemo(() => (note ? notes.filter((n) => n.links.includes(note.rel)) : []), [note, notes])
  const outline = useMemo(() => headings(parseFrontmatter(content).body), [content])

  // Folder sections for the tree, filtered.
  const q = filter.trim().toLowerCase()
  const sections = useMemo(() => {
    const shown = q ? notes.filter((n) => `${n.title} ${n.rel} ${n.tags.join(' ')}`.toLowerCase().includes(q)) : notes
    const map = new Map<string, VaultNote[]>()
    for (const n of shown) map.set(n.folder, [...(map.get(n.folder) ?? []), n])
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [notes, q])

  const linkCount = notes.reduce((s, n) => s + n.links.length, 0)

  const toggleAuto = async () => {
    await window.mc.setProjectMeta(project.path, { autoDocs: !project.meta.autoDocs })
    onChanged()
  }

  const createNote = async () => {
    const name = (newName ?? '').trim().replace(/\.md$/i, '').replace(/[<>:"\\|?*]/g, '')
    setNewName(null)
    if (!name) return
    const rel = `docs/${name}.md`
    if (byRel.has(rel)) return open(rel)
    const today = new Date().toLocaleDateString('sv')
    const title = name.split('/').pop()!
    try {
      await window.mc.writeDoc(`${project.path}\\${rel.replace(/\//g, '\\')}`, `---\ntitle: ${title}\ntags: []\nupdated: ${today}\n---\n# ${title}\n\nBack to [[INDEX]]\n`)
      load()
      open(rel)
    } catch (e) {
      toast('error', 'Could not create the note', errorMessage(e))
    }
  }

  if (!info) return <div className="muted pad">Opening the vault…</div>

  return (
    <div className="vault">
      <div className="vault-head">
        <span className="vault-title">
          <BookOpen size={16} />
          <span className="strong">Docs vault</span>
          <span className="muted small">
            {notes.length} note{notes.length === 1 ? '' : 's'} · {linkCount} link{linkCount === 1 ? '' : 's'}
            {info.updatedAt > 0 && ` · Claude updated it ${timeAgo(info.updatedAt)}`}
          </span>
          {info.hasIndex &&
            (info.claudeMdLinked ? (
              <span className="vault-chip ok" title="CLAUDE.md tells every chat to start from docs/INDEX.md">
                <Sparkles size={11} /> Claude reads this
              </span>
            ) : (
              <span className="vault-chip warn" title="CLAUDE.md doesn't point at docs/INDEX.md yet; updating the vault adds it">
                <CircleAlert size={11} /> Not linked from CLAUDE.md
              </span>
            ))}
        </span>
        <span className="vault-actions">
          {info.hasIndex && (
            <label className="vault-auto" title="After each compaction (a session briefing), Claude updates the vault as a background task. Uses your plan.">
              <input type="checkbox" checked={!!project.meta.autoDocs} onChange={toggleAuto} />
              Keep up to date
            </label>
          )}
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'notes', label: 'Notes', icon: FileText },
              { value: 'graph', label: 'Graph', icon: Network }
            ]}
          />
          <Button size="sm" variant={info.hasIndex ? 'secondary' : 'primary'} icon={running ? Loader2 : Sparkles} disabled={running} onClick={() => setBuildOpen(true)} className={running ? 'spin-icon' : ''}>
            {running ? 'Claude is writing…' : info.hasIndex ? 'Update with Claude' : 'Build vault with Claude'}
          </Button>
          <IconButton icon={RefreshCw} label="Reload" size={14} onClick={load} />
          <IconButton icon={FolderOpen} label="Open docs folder" size={14} onClick={() => window.mc.openInExplorer(`${project.path}\\docs`)} />
        </span>
      </div>

      {task && (running || task.run?.error) && (
        <div className={`vault-banner ${task.run?.error ? 'bad' : ''}`}>
          {running ? <Loader2 size={14} className="spin" /> : <CircleAlert size={14} />}
          <span className="ellipsis">
            {running
              ? `Claude is ${task.title.endsWith('build') ? 'building' : 'updating'} the vault: ${task.run?.activity ?? 'starting…'}`
              : `The last vault ${task.title.endsWith('build') ? 'build' : 'update'} stopped: ${task.run?.error}`}
          </span>
          <span className="muted small">
            {task.run?.toolCalls ? `${task.run.toolCalls} steps` : ''}
            {task.run?.costUsd ? ` · ${formatCost(task.run.costUsd)} at API prices` : ''}
            {task.run?.costUsd ? <PlanShare usd={task.run.costUsd} prefix=" · " long /> : null}
          </span>
        </div>
      )}

      <div className="vault-body">
        <aside className="vault-tree">
          <div className="vault-search">
            <Search size={13} />
            <input placeholder="Find a note" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {filter && <IconButton icon={X} label="Clear" size={12} onClick={() => setFilter('')} />}
          </div>
          <div className="vault-tree-list scroll">
            {sections.map(([folder, list]) => {
              const closed = collapsed.has(folder) && !q
              const depth = folder ? folder.split('/').length - 1 : 0
              return (
                <div key={folder || '.'} className="vault-folder">
                  <button
                    className="vault-folder-head"
                    style={{ paddingLeft: 6 + depth * 12 }}
                    onClick={() =>
                      setCollapsed((c) => {
                        const n = new Set(c)
                        if (n.has(folder)) n.delete(folder)
                        else n.add(folder)
                        return n
                      })
                    }
                  >
                    {closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="ellipsis">{folderLabel(folder)}</span>
                    <span className="muted tiny">{list.length}</span>
                  </button>
                  {!closed &&
                    list.map((n) => (
                      <button
                        key={n.rel}
                        className={`vault-note ${current === n.rel && mode === 'notes' ? 'selected' : ''}`}
                        style={{ paddingLeft: 22 + depth * 12 }}
                        onClick={() => open(n.rel)}
                        title={`${n.rel}\nUpdated ${timeAgo(n.mtime)}${n.generated ? '\nWritten by Claude' : ''}`}
                      >
                        {n.generated ? <Sparkles size={12} className="vault-gen" /> : <FileText size={12} />}
                        <span className="ellipsis">{n.title}</span>
                      </button>
                    ))}
                </div>
              )
            })}
            {!sections.length && <div className="muted small pad">{q ? 'No notes match.' : 'No notes yet.'}</div>}
          </div>
          {newName === null ? (
            <button className="vault-new" onClick={() => setNewName('')}>
              <FilePlus2 size={13} /> New note
            </button>
          ) : (
            <div className="vault-new-input">
              <span className="muted small">docs/</span>
              <input
                autoFocus
                placeholder="note-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNote()
                  if (e.key === 'Escape') setNewName(null)
                }}
                onBlur={() => void createNote()}
              />
            </div>
          )}
        </aside>

        <main className="vault-main">
          {mode === 'graph' ? (
            notes.length ? (
              <VaultGraph notes={notes} current={current ?? undefined} onOpen={open} />
            ) : (
              <div className="muted pad">No notes to graph yet.</div>
            )
          ) : note ? (
            <DocViewer
              key={note.path}
              doc={{ name: note.title, path: note.path, version: note.mtime }}
              subtitle={note.rel}
              onLink={link}
              exists={exists}
              onContent={setContent}
              actions={
                <>
                  <IconButton icon={ArrowLeft} label="Back" size={14} onClick={() => go(-1)} disabled={history.at <= 0} />
                  <IconButton icon={ArrowRight} label="Forward" size={14} onClick={() => go(1)} disabled={history.at >= history.stack.length - 1} />
                </>
              }
            />
          ) : (
            <VaultHero hasNotes={notes.length > 0} running={running} onBuild={() => setBuildOpen(true)} />
          )}
        </main>

        {mode === 'notes' && note && (
          <aside className="vault-side scroll">
            {outline.length > 1 && (
              <section>
                <h4>
                  <ListTree size={12} /> Outline
                </h4>
                {outline.map((h, i) => (
                  <button key={i} className="vault-outline" style={{ paddingLeft: 4 + (h.level - 1) * 10 }} onClick={() => document.getElementById(h.slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    {h.text}
                  </button>
                ))}
              </section>
            )}
            <section>
              <h4>
                <Link2 size={12} /> Links <span className="muted">{note.links.length}</span>
              </h4>
              {note.links.map((rel) => (
                <button key={rel} className="vault-ref" onClick={() => open(rel)} title={rel}>
                  {byRel.get(rel)?.title ?? rel}
                </button>
              ))}
              {note.unresolved.map((t) => (
                <span key={t} className="vault-ref missing" title="No such note yet">
                  {t}
                </span>
              ))}
              {!note.links.length && !note.unresolved.length && <p className="muted tiny">This note links to nothing.</p>}
            </section>
            <section>
              <h4>
                <ArrowLeft size={12} /> Backlinks <span className="muted">{backlinks.length}</span>
              </h4>
              {backlinks.map((n) => (
                <button key={n.rel} className="vault-ref" onClick={() => open(n.rel)} title={n.rel}>
                  {n.title}
                </button>
              ))}
              {!backlinks.length && <p className="muted tiny">No notes link here yet.</p>}
            </section>
          </aside>
        )}
      </div>

      {buildOpen && (
        <BuildDialog
          project={project}
          update={info.hasIndex}
          onClose={() => setBuildOpen(false)}
          onStarted={() => {
            setBuildOpen(false)
            toast('success', info.hasIndex ? 'Claude is updating the vault' : 'Claude is building the vault', 'Notes appear here as they are written. It runs as a task, so you can keep working.')
          }}
        />
      )}
    </div>
  )
}

/** The empty middle before a vault exists: what it is and the button to build it. */
function VaultHero({ hasNotes, running, onBuild }: { hasNotes: boolean; running: boolean; onBuild: () => void }) {
  return (
    <div className="vault-hero scroll">
      <div className="vault-hero-card">
        <div className="vault-hero-icon">
          <BookOpen size={26} />
        </div>
        <h2>Give Claude a map of this project</h2>
        <p className="muted">
          Claude reads the code and your docs, then writes a linked set of notes in <code>docs/</code>, like an Obsidian vault. CLAUDE.md points every new chat at it, so Claude starts each session knowing the architecture, how to run
          things, the rules and where work stands.
        </p>
        <ul className="vault-plan">
          {PLANNED.map(([name, what]) => (
            <li key={name}>
              <Sparkles size={12} />
              <span className="strong">{name}</span>
              <span className="muted">{what}</span>
            </li>
          ))}
        </ul>
        <Button variant="primary" icon={running ? Loader2 : Sparkles} disabled={running} onClick={onBuild}>
          {running ? 'Claude is writing…' : 'Build vault with Claude'}
        </Button>
        {hasNotes && <p className="muted tiny">Your existing notes are on the left; Claude links them in and never deletes or rewrites them.</p>}
      </div>
    </div>
  )
}

const MODELS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' }
] as const

/** Confirms a build or update: what it does, which model, and where your plan limits stand. */
function BuildDialog({ project, update, onClose, onStarted }: { project: Project; update: boolean; onClose: () => void; onStarted: () => void }) {
  const toast = useToast()
  const [model, setModel] = useState<string>('sonnet')
  const [busy, setBusy] = useState(false)
  const [limits, setLimits] = useState<RateLimitInfo | null>(null)
  useEffect(() => {
    window.mc.getRateLimit().then(setLimits)
  }, [])
  const session = limits?.windows.find((w) => w.name === 'five_hour')
  const pct = session ? Math.round(session.utilization * 100) : null

  const start = async () => {
    setBusy(true)
    try {
      await window.mc.buildVault(project.path, project.name, update ? 'update' : 'build', model)
      onStarted()
    } catch (e) {
      toast('error', 'Could not start', errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog vault-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dialog-head">
          <h2>
            <Sparkles size={16} /> {update ? 'Update' : 'Build'} the docs vault for {project.name}
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">
          <p>
            {update
              ? 'Claude checks what changed (newest briefings, git history, the code they touch), refreshes status.md and fixes notes that are out of date.'
              : 'Claude reads the project and writes the notes in docs/, links them together, and adds a "Project docs" section to CLAUDE.md so every chat starts from docs/INDEX.md.'}{' '}
            It runs in the background as a task (Tasks board); it only writes Markdown and never changes your code.
          </p>
          <div className="field">
            <span className="field-label">Model</span>
            <Segmented value={model} onChange={setModel} options={MODELS.map((m) => ({ ...m }))} />
            <span className="field-hint">Sonnet writes good docs for much less of your plan than Opus. Haiku is cheapest, but its notes are thinner.</span>
          </div>
          {pct !== null && (
            <p className={`small ${pct >= 80 ? 'vault-warn' : 'muted'}`}>
              Your session limit is at {pct}%. {update ? 'An update' : 'A build'} usually takes {update ? 'a few' : 'several'} percent of a Pro session{pct >= 80 ? '; you may want to wait for the reset.' : '.'}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Sparkles} onClick={start} disabled={busy}>
            {busy ? 'Starting…' : update ? 'Update vault' : 'Build vault'}
          </Button>
        </div>
      </div>
    </div>
  )
}
