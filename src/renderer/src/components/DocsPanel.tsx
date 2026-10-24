import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import type { DocFile } from '@shared/types'
import DocViewer from './DocViewer'
import { EmptyState } from './ui'

interface Props {
  projectPath: string
}

export default function DocsPanel({ projectPath }: Props) {
  const [docs, setDocs] = useState<DocFile[] | null>(null)
  const [current, setCurrent] = useState<DocFile | null>(null)

  useEffect(() => {
    window.mc.listDocs(projectPath).then((list) => {
      setDocs(list)
      setCurrent(list[0] ?? null)
    })
  }, [projectPath])

  if (docs === null) return <div className="muted pad">Looking for docs…</div>
  if (docs.length === 0) {
    return (
      <EmptyState icon={FileText} title="No docs found">
        Mission Control looks for CLAUDE.md, README.md, AGENTS.md and Markdown files in docs/ and .claude/.
      </EmptyState>
    )
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
      {current && <DocViewer key={current.path} doc={current} />}
    </div>
  )
}
