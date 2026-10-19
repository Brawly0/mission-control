import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import type { DocFile } from '@shared/types'

interface Props {
  projectPath: string
}

export default function DocsPanel({ projectPath }: Props) {
  const [docs, setDocs] = useState<DocFile[]>([])
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

  if (docs.length === 0) {
    return (
      <div className="empty">
        No docs found. Mission Control looks for CLAUDE.md, README.md and Markdown files in docs/ and .claude/.
      </div>
    )
  }

  return (
    <div className="docs">
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d.path}>
            <button className={current?.path === d.path ? 'selected' : ''} onClick={() => setCurrent(d)}>
              {d.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="doc-view">
        <div className="doc-toolbar">
          <span className="mono small muted">{current?.path}</span>
          {draft === null ? (
            <button className="btn small" onClick={() => setDraft(content)}>
              Edit
            </button>
          ) : (
            <span className="toolbar">
              <button className="btn small" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                className="btn small primary"
                disabled={saving}
                onClick={async () => {
                  if (!current) return
                  setSaving(true)
                  await window.mc.writeDoc(current.path, draft)
                  setContent(draft)
                  setDraft(null)
                  setSaving(false)
                }}
              >
                Save
              </button>
            </span>
          )}
        </div>
        {draft === null ? (
          <div className="markdown">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <textarea className="doc-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
        )}
      </div>
    </div>
  )
}
