import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react'
import { Kbd } from './ui'

export interface Command {
  id: string
  title: string
  group: string
  icon?: LucideIcon
  hint?: string
  /** Extra text matched by search but not shown. */
  keywords?: string
  run: () => void
}

/** Scores how well `query` matches `text` as an in-order subsequence; 0 means no match. */
function score(query: string, text: string): number {
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx
  let ti = 0
  let s = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return 0
    s += found === ti ? 3 : 1
    ti = found + 1
  }
  return s
}

export default function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    // Without a query, keep each group together (in order of first appearance) so no heading shows twice.
    const groupOrder = new Map<string, number>()
    for (const c of commands) if (!groupOrder.has(c.group)) groupOrder.set(c.group, groupOrder.size)
    return commands
      .map((c) => ({ c, s: score(query, `${c.title} ${c.keywords ?? ''} ${c.group}`) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => (query ? b.s - a.s : groupOrder.get(a.c.group)! - groupOrder.get(b.c.group)!))
      .slice(0, 60)
      .map((r) => r.c)
  }, [commands, query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const runAt = (i: number) => {
    const cmd = results[i]
    if (!cmd) return
    onClose()
    cmd.run()
  }

  let lastGroup = ''
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search projects, agents, chats and actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                runAt(index)
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="muted pad">Nothing matches “{query}”.</div>}
          {results.map((c, i) => {
            const header = !query && c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            const Icon = c.icon
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button className={`palette-item ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => runAt(i)}>
                  {Icon && <Icon size={15} strokeWidth={1.9} />}
                  <span className="ellipsis">{c.title}</span>
                  {c.hint && <span className="palette-hint ellipsis">{c.hint}</span>}
                  {i === index && <CornerDownLeft size={13} className="palette-enter" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
