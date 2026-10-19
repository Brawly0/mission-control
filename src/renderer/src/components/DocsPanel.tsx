import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { FileText, Pencil, Save } from 'lucide-react'
import type { DocFile } from '@shared/types'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import { Button, EmptyState } from './ui'

interface Props {
  projectPath: string
}

export default function DocsPanel({ projectPath }: Props) {
  const toast = useToast()
  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const [current, setCurrent] = useState<DocFile | null>(null)
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.mc.listDocs(projectPath).then((list) => {
      setDocs(list)
      setCurrent(list[0] ?? null)
    })
  }, [projectPath])

  useEffect(() => {
    setDraft(null)
    if (!current) {
      setContent('')
      return
    }
    window.mc.readDoc(current.path).then(setContent).catch(() => setContent('*Could not read this file.*'))
  }, [current])

  if (docs === null) return <div className="muted pad">Looking for docs…</div>
  if (docs.length === 0) {
    return (
      <EmptyState icon={FileText} title="No docs found">
        Mission Control looks for CLAUDE.md, README.md, AGENTS.md and Markdown files in docs/ and .claude/.
      </EmptyState>
    )
  }

  const save = async () => {
    if (!current || draft === null) return
    setSaving(true)
    try {
      await window.mc.writeDoc(current.path, draft)
      setContent(draft)
      setDraft(null)
      toast('success', 'Saved', current.name)
    } catch (e) {
      toast('error', 'Could not save', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="docs">
      <ul className="doc-list scroll">
        {docs.map((d) => (
          <li key={d.path}>
            <button className={current?.path === d.path ? 'selected' : ''} onClick={() => setCurrent(d)} title={d.path}>
              <FileText size={14} />
              <span className="ellipsis">{d.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="doc-view">
        <div className="doc-toolbar">
          <span className="strong">{current?.name}</span>
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key === 's') {
                e.preventDefault()
                save()
              }
            }}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}
