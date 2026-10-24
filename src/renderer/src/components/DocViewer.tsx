import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { FolderOpen, Pencil, Save } from 'lucide-react'
import type { DocFile } from '@shared/types'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import { Button, IconButton } from './ui'

/** Reads a Markdown file and lets you edit it in place (Ctrl+S saves). Used by Docs and Knowledge. */
export default function DocViewer({ doc, subtitle }: { doc: DocFile; subtitle?: string }) {
  const toast = useToast()
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(null)
    window.mc.readDoc(doc.path).then(setContent).catch(() => setContent('*Could not read this file.*'))
  }, [doc.path])

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
        <IconButton icon={FolderOpen} label="Show in Explorer" size={14} onClick={() => window.mc.openInExplorer(doc.path.replace(/[\\/][^\\/]+$/, ''))} />
        {draft === null ? (
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setDraft(content)}>
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
          <Markdown>{content}</Markdown>
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
