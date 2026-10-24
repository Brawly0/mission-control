import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { Eye, FolderOpen, NotebookPen, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import type { Note, Project } from '@shared/types'
import { timeAgo } from '../util'
import { useKeyFor, withKey } from '../shortcuts'
import { Avatar, Button, EmptyState, IconButton } from './ui'

type Selection = { kind: 'note'; id: string } | { kind: 'project'; path: string } | null

interface Props {
  projects: Project[]
  visible: boolean
  /** Bumped by the New note shortcut. */
  newNoteRequest: number
  onOpenProject: (path: string) => void
  /** A project's notes changed (saved to its settings). */
  onProjectNotesSaved: () => void
}

/** Your own notes, plus every project's notes, in one place. Everything saves as you type. */
export default function NotebookView({ projects, visible, newNoteRequest, onOpenProject, onProjectNotesSaved }: Props) {
  const keyFor = useKeyFor()
  const [notes, setNotes] = useState<Note[]>([])
  const [sel, setSel] = useState<Selection>(null)
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState(false)
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: '', body: '' })
  const [saved, setSaved] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const load = () => window.mc.listNotes().then(setNotes)
  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    const n = await window.mc.saveNote({ title: '', body: '' })
    await load()
    setSel({ kind: 'note', id: n.id })
    setPreview(false)
    setTimeout(() => titleRef.current?.focus(), 50)
  }
  useEffect(() => {
    if (newNoteRequest) void create()
  }, [newNoteRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  const projectNotes = projects.filter((p) => !p.worktree && p.meta.notes.trim())
  const otherProjects = projects.filter((p) => !p.worktree && !p.meta.notes.trim())
  const note = sel?.kind === 'note' ? notes.find((n) => n.id === sel.id) : undefined
  const project = sel?.kind === 'project' ? projects.find((p) => p.path === sel.path) : undefined

  // Pick something to show the first time.
  useEffect(() => {
    if (sel || !visible) return
    if (notes[0]) setSel({ kind: 'note', id: notes[0].id })
    else if (projectNotes[0]) setSel({ kind: 'project', path: projectNotes[0].path })
  }, [visible, notes.length, projectNotes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load the selection into the editor (flush any pending save first).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    setSaved(true)
    if (note) setDraft({ title: note.title, body: note.body })
    else if (project) setDraft({ title: project.name, body: project.meta.notes })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  const change = (next: { title: string; body: string }) => {
    setDraft(next)
    setSaved(false)
    if (timer.current) clearTimeout(timer.current)
    const target = sel
    timer.current = setTimeout(async () => {
      if (target?.kind === 'note') {
        await window.mc.saveNote({ id: target.id, title: next.title, body: next.body })
        void load()
      } else if (target?.kind === 'project') {
        await window.mc.setProjectMeta(target.path, { notes: next.body })
        onProjectNotesSaved()
      }
      setSaved(true)
    }, 600)
  }

  const q = query.trim().toLowerCase()
  const matches = (text: string) => !q || text.toLowerCase().includes(q)
  const noteTitle = (n: Note) => n.title.trim() || n.body.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) || 'Untitled note'

  return (
    <div className="notebook">
      <aside className="nb-list">
        <div className="kn-head">
          <h1>
            <NotebookPen size={18} /> Notebook
          </h1>
          <IconButton icon={Plus} label={withKey('New note', keyFor('newNote'))} onClick={() => void create()} />
        </div>
        <div className="toolbar-search">
          <Search size={14} />
          <input placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        </div>
        <div className="kn-scroll scroll">
          <div className="nb-section">My notes</div>
          {notes.filter((n) => matches(`${n.title} ${n.body}`)).length === 0 && <div className="muted small pad">{q ? 'No notes match.' : 'No notes yet.'}</div>}
          <ul>
            {notes
              .filter((n) => matches(`${n.title} ${n.body}`))
              .map((n) => (
                <li key={n.id}>
                  <button className={`kn-doc ${sel?.kind === 'note' && sel.id === n.id ? 'selected' : ''}`} onClick={() => setSel({ kind: 'note', id: n.id })}>
                    {n.pinned ? <Pin size={13} className="tone-accent" /> : <NotebookPen size={13} />}
                    <span className="kn-doc-text">
                      <span className="ellipsis">{noteTitle(n)}</span>
                      <span className="muted tiny">{timeAgo(n.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          <div className="nb-section">Project notes</div>
          <ul>
            {[...projectNotes, ...(q ? [] : otherProjects)]
              .filter((p) => matches(`${p.name} ${p.meta.notes}`))
              .map((p) => (
                <li key={p.path}>
                  <button className={`kn-doc ${sel?.kind === 'project' && sel.path === p.path ? 'selected' : ''} ${p.meta.notes.trim() ? '' : 'faded'}`} onClick={() => setSel({ kind: 'project', path: p.path })}>
                    <Avatar name={p.name} path={p.path} size={18} />
                    <span className="kn-doc-text">
                      <span className="ellipsis">{p.name}</span>
                      <span className="muted tiny ellipsis">{p.meta.notes.trim() ? p.meta.notes.trim().split('\n')[0].slice(0, 60) : 'No notes yet'}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </aside>

      <section className="nb-editor">
        {!note && !project ? (
          <EmptyState icon={NotebookPen} title="Write something down">
            <p>Ideas, links, prompts you reuse, what to do next. Project notes also show in each project’s Overview.</p>
            <Button variant="primary" icon={Plus} onClick={() => void create()}>
              New note
            </Button>
          </EmptyState>
        ) : (
          <>
            <div className="nb-toolbar">
              {project ? (
                <span className="nb-project">
                  <Avatar name={project.name} path={project.path} size={22} />
                  <span className="strong">{project.name}</span>
                  <span className="muted small">project notes</span>
                </span>
              ) : (
                <input ref={titleRef} className="nb-title" placeholder="Title" value={draft.title} onChange={(e) => change({ ...draft, title: e.target.value })} />
              )}
              <span className="muted small nb-saved">{saved ? 'Saved' : 'Saving…'}</span>
              <IconButton icon={preview ? Pencil : Eye} label={preview ? 'Edit' : 'Preview'} active={preview} onClick={() => setPreview((v) => !v)} />
              {project && <IconButton icon={FolderOpen} label="Open project" onClick={() => onOpenProject(project.path)} />}
              {note && (
                <>
                  <IconButton
                    icon={note.pinned ? PinOff : Pin}
                    label={note.pinned ? 'Unpin' : 'Pin to top'}
                    onClick={async () => {
                      await window.mc.saveNote({ id: note.id, pinned: !note.pinned })
                      void load()
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    label="Delete note"
                    onClick={async () => {
                      if (!confirm(`Delete “${noteTitle(note)}”? This can't be undone.`)) return
                      await window.mc.deleteNote(note.id)
                      setSel(null)
                      void load()
                    }}
                  />
                </>
              )}
            </div>
            {preview ? (
              <div className="markdown scroll nb-preview">
                <Markdown>{draft.body || '*Nothing here yet.*'}</Markdown>
              </div>
            ) : (
              <textarea
                className="nb-body"
                placeholder="Write in Markdown…"
                value={draft.body}
                onChange={(e) => change({ ...draft, body: e.target.value })}
                spellCheck
              />
            )}
          </>
        )}
      </section>
    </div>
  )
}
