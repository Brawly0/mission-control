import { useMemo } from 'react'
import { parseDiff, type FileDiff } from '../diff'

export { parseDiff }

const MAX_LINES = 1500

export default function DiffView({ file }: { file: FileDiff | undefined }) {
  const rows = useMemo(() => {
    if (!file) return []
    let oldNo = 0
    let newNo = 0
    return file.lines.slice(0, MAX_LINES).map((line) => {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (hunk) {
        oldNo = Number(hunk[1])
        newNo = Number(hunk[2])
        return { kind: 'hunk', text: line, a: '', b: '' }
      }
      if (line.startsWith('@@') || line.startsWith('Binary')) return { kind: 'hunk', text: line, a: '', b: '' }
      if (line.startsWith('+')) return { kind: 'add', text: line.slice(1), a: '', b: String(newNo++) }
      if (line.startsWith('-')) return { kind: 'del', text: line.slice(1), a: String(oldNo++), b: '' }
      if (line.startsWith('\\')) return { kind: 'meta', text: line, a: '', b: '' }
      return { kind: 'ctx', text: line.slice(1), a: String(oldNo++), b: String(newNo++) }
    })
  }, [file])

  if (!file) return <div className="diff-empty muted">Select a file to see its changes.</div>
  return (
    <div className="diff">
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`diff-${r.kind}`}>
              <td className="ln">{r.a}</td>
              <td className="ln">{r.b}</td>
              <td className="sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</td>
              <td className="code">{r.text || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {file.lines.length > MAX_LINES && <div className="muted pad">Diff truncated to {MAX_LINES} lines.</div>}
    </div>
  )
}
