import { useEffect, useState } from 'react'
import { FolderOpen, Pencil, Save } from 'lucide-react'
import type { DocFile } from '@shared/types'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import NoteMarkdown from './NoteMarkdown'
import { Button, IconButton, LoadingState } from './ui'

interface Props {
  doc: DocFile
  subtitle?: string
  /** Note links ([[wikilinks]], relative .md paths) and whether their targets exist; see NoteMarkdown. */
  onLink?: (target: string) => void
  exists?: (target: string) => boolean
  /** Sees the file's text whenever it's loaded or saved (for an outline). */
  onContent?: (text: string) => void
  /** Extra buttons for the toolbar, before Edit. */
  actions?: React.ReactNode
}

/** Reads a Markdown file and lets you edit it in place (Ctrl+S saves). Used by Docs (the vault) and Knowledge. */
export default function DocViewer({ doc, subtitle, onLink, exists, onContent, actions }: Props) {
  const toast = useToast()
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(null)
  }, [doc.path])
  // Re-read when the file changes on disk too (Claude writing it); an open edit is kept.
  useEffect(() => {
    let current = true
    setLoading(true); setError(null)
    window.mc.readDoc(doc.path)
      .then(text => { if (current) setContent(text) })
      .catch(e => { if (current) setError(errorMessage(e)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [doc.path, doc.version])
  useEffect(() => onContent?.(content), [content]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (draft === null) return
    setSaving(true)
    try {
      await window.mc.writeDoc(doc.path, draft)
      setContent(draft)
      setDraft(null)
      toast('success', 'Saved', doc.name)
    } catch (e) {
      toast('error', 'Could not save', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <span className="doc-title">
          <span className="strong ellipsis">{doc.name}</span>
          {subtitle && <span className="muted small ellipsis">{subtitle}</span>}
        </span>
        {actions}
        <IconButton icon={FolderOpen} label="Show in Explorer" size={14} onClick={() => window.mc.openInExplorer(doc.path.replace(/[\\/][^\\/]+$/, ''))} />
        {draft === null ? (
          <Button size="sm" variant="ghost" icon={Pencil} disabled={loading || !!error} onClick={() => setDraft(content)}>
            Edit
          </Button>
        ) : (
          <span className="toolbar">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" icon={Save} disabled={saving} onClick={save}>
              Save
            </Button>
          </span>
        )}
      </div>
      {draft === null ? (
        <div className="markdown scroll">
          {loading ? <LoadingState>Reading document…</LoadingState> : error ? <div className="error pad" role="alert">Could not read this file. {error}</div> : <NoteMarkdown text={content} onLink={onLink} exists={exists} />}
        </div>
      ) : (
        <textarea
          className="doc-editor"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 's') {
              e.preventDefault()
              void save()
            }
            if (e.key === 'Escape') setDraft(null)
          }}
          spellCheck={false}
        />
      )}
    </div>
  )
}
