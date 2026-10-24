import { useMemo, useRef, useState } from 'react'
import type { VaultNote } from '@shared/types'

interface Props {
  notes: VaultNote[]
  current?: string
  onOpen: (rel: string) => void
}

const COLORS = ['var(--accent)', 'var(--blue)', 'var(--green)', 'var(--yellow)', 'var(--orange)', 'var(--red)', 'var(--text-2)']

/** Colour group for a note: its folder, with the project root and docs/ as their own groups. */
export function groupOf(n: VaultNote): string {
  return n.folder || 'project root'
}

interface Pos {
  x: number
  y: number
}

/** A simple force layout (repulsion, springs on links, a pull to the middle), computed once per vault. */
function layout(notes: VaultNote[], edges: [number, number][]): Pos[] {
  const n = notes.length
  // Start each folder on its own arc so the layout comes out the same every time.
  const groups = [...new Set(notes.map(groupOf))]
  const pos: Pos[] = notes.map((note, i) => {
    const g = groups.indexOf(groupOf(note))
    const a = (g / Math.max(1, groups.length)) * Math.PI * 2 + (i % 7) * 0.35
    const r = 120 + (i % 5) * 30
    return { x: Math.cos(a) * r, y: Math.sin(a) * r }
  })
  const k = 70
  const rim = k * (1.5 + Math.sqrt(n))
  const steps = n > 300 ? 120 : 260
  for (let step = 0; step < steps; step++) {
    const temp = 18 * (1 - step / steps) + 0.5
    const disp = pos.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = (i - j) * 0.1
          dy = 0.1
          d2 = dx * dx + dy * dy
        }
        const f = (k * k) / d2
        disp[i].x += dx * f
        disp[i].y += dy * f
        disp[j].x -= dx * f
        disp[j].y -= dy * f
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[a].x - pos[b].x
      const dy = pos[a].y - pos[b].y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = d / k
      disp[a].x -= dx * f
      disp[a].y -= dy * f
      disp[b].x += dx * f
      disp[b].y += dy * f
    }
    for (let i = 0; i < n; i++) {
      disp[i].x -= pos[i].x * 0.05
      disp[i].y -= pos[i].y * 0.05
      const d = Math.sqrt(disp[i].x ** 2 + disp[i].y ** 2) || 1
      pos[i].x += (disp[i].x / d) * Math.min(d, temp)
      pos[i].y += (disp[i].y / d) * Math.min(d, temp)
      // Unlinked notes would drift off; keep them on the rim, like Obsidian's orphans.
      const r = Math.sqrt(pos[i].x ** 2 + pos[i].y ** 2)
      if (r > rim) {
        pos[i].x *= rim / r
        pos[i].y *= rim / r
      }
    }
  }
  // Centre the linked notes, not the orphans around them.
  const linked = new Set(edges.flat())
  const core = linked.size ? pos.filter((_p, i) => linked.has(i)) : pos
  const cx = core.reduce((s, p) => s + p.x, 0) / (core.length || 1)
  const cy = core.reduce((s, p) => s + p.y, 0) / (core.length || 1)
  return pos.map((p) => ({ x: p.x - cx, y: p.y - cy }))
}

/** Obsidian-style graph of the vault: notes as dots sized by links, coloured by folder. Drag to pan, wheel to zoom. */
export default function VaultGraph({ notes, current, onOpen }: Props) {
  const { edges, degree, groups } = useMemo(() => {
    const index = new Map(notes.map((n, i) => [n.rel, i]))
    const seen = new Set<string>()
    const edges: [number, number][] = []
    for (const [i, n] of notes.entries()) {
      for (const l of n.links) {
        const j = index.get(l)
        if (j === undefined) continue
        const key = i < j ? `${i}:${j}` : `${j}:${i}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push([i, j])
      }
    }
    const degree = notes.map(() => 0)
    for (const [a, b] of edges) {
      degree[a]++
      degree[b]++
    }
    return { edges, degree, groups: [...new Set(notes.map(groupOf))] }
  }, [notes])
  const pos = useMemo(() => layout(notes, edges), [notes, edges])
  const [hover, setHover] = useState<number | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const bounds = useMemo(() => {
    // Centred on the linked notes (0, 0), wide enough for every note.
    const rx = Math.max(150, ...pos.map((p) => Math.abs(p.x))) + 60
    const ry = Math.max(120, ...pos.map((p) => Math.abs(p.y))) + 40
    return { minX: -rx, minY: -ry, w: 2 * rx, h: 2 * ry }
  }, [pos])

  const neighbours = useMemo(() => {
    if (hover === null) return null
    const s = new Set([hover])
    for (const [a, b] of edges) {
      if (a === hover) s.add(b)
      if (b === hover) s.add(a)
    }
    return s
  }, [hover, edges])

  const color = (n: VaultNote) => COLORS[groups.indexOf(groupOf(n)) % COLORS.length]

  return (
    <div className="vault-graph">
      <svg
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`}
        onWheel={(e) => {
          const scale = Math.min(4, Math.max(0.4, view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
          setView((v) => ({ ...v, scale }))
        }}
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (!d) return
          const ratio = bounds.w / (e.currentTarget.clientWidth || 1) / view.scale
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
          setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x) * ratio, y: d.vy + (e.clientY - d.y) * ratio }))
        }}
        onMouseUp={() => setTimeout(() => (drag.current = null))}
        onMouseLeave={() => (drag.current = null)}
      >
        <g transform={`translate(${view.x * view.scale} ${view.y * view.scale}) scale(${view.scale})`}>
          {edges.map(([a, b], i) => {
            const lit = neighbours ? neighbours.has(a) && neighbours.has(b) : false
            return (
              <line
                key={i}
                x1={pos[a].x}
                y1={pos[a].y}
                x2={pos[b].x}
                y2={pos[b].y}
                className={`vg-edge ${lit ? 'lit' : ''} ${neighbours && !lit ? 'dim' : ''}`}
              />
            )
          })}
          {notes.map((n, i) => {
            const r = 4 + Math.sqrt(degree[i]) * 2.2
            const dim = neighbours && !neighbours.has(i)
            const showLabel = degree[i] >= 2 || hover === i || n.rel === current || view.scale > 1.4 || notes.length < 25
            return (
              <g
                key={n.rel}
                className={`vg-node ${dim ? 'dim' : ''} ${n.rel === current ? 'current' : ''}`}
                transform={`translate(${pos[i].x} ${pos[i].y})`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => !drag.current?.moved && onOpen(n.rel)}
              >
                <title>{`${n.title}\n${n.rel}\n${degree[i]} link${degree[i] === 1 ? '' : 's'}`}</title>
                {n.rel === current && <circle r={r + 4} className="vg-ring" />}
                <circle r={r} style={{ fill: color(n) }} />
                {showLabel && (
                  <text y={r + 12} className="vg-label">
                    {n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="vg-legend">
        {groups.map((g, i) => (
          <span key={g}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            {g}
          </span>
        ))}
      </div>
      <div className="vg-hint muted tiny">Drag to move · scroll to zoom · click a note to open it</div>
    </div>
  )
}
