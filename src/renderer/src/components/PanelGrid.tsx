import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type CSSProperties } from 'react'
import { GripVertical } from 'lucide-react'
import { arrangePanels, gridOptions, gridShape } from '../panelGrid'

type Tracks = { cols: number[]; rows: number[] }
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}
function write(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* optional preference */ } }

export function GridPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <select className="select panel-grid-picker" aria-label="Grid arrangement" value={gridOptions.some(([id]) => id === value) ? value : 'auto'} onChange={e => onChange(e.target.value)}>{gridOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
}

export function usePanelGrid(ids: string[], preset: string, storageKey: string) {
  const stageRef = useRef<HTMLDivElement>(null)
  const endResize = useRef<(() => void) | null>(null)
  useEffect(() => () => endResize.current?.(), [])
  const loadOrder = () => { const stored = read<unknown>(`${storageKey}.order`, []); return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [] }
  const [savedOrder, setOrderState] = useState<string[]>(loadOrder)
  const setOrder = (order: string[]) => { setOrderState(order); write(`${storageKey}.order`, order) }
  const [sizes, setSizes] = useState<Record<string, Tracks>>(() => read(storageKey, {}))
  const [source, setSource] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; mode: 'before' | 'after' | 'swap' } | null>(null)
  useEffect(() => { setSizes(read(storageKey, {})); setOrderState(loadOrder()); setSource(null); setDrop(null) }, [storageKey])
  const order = [...savedOrder.filter(id => ids.includes(id)), ...ids.filter(id => !savedOrder.includes(id))]
  const { cols, rows } = gridShape(ids.length, preset)
  const shape = `${cols}x${rows}`
  const candidate = sizes?.[shape]
  const valid = (a: unknown, count: number): a is number[] => Array.isArray(a) && a.length === count && a.every(n => Number.isFinite(n) && n > 0)
  const tracks = candidate && valid(candidate.cols, cols) && valid(candidate.rows, rows) ? candidate : { cols: Array(cols).fill(1), rows: Array(rows).fill(1) }
  const template = (values: number[]) => values.map(n => `minmax(0, ${n}fr)`).join(' 6px ')
  const style: CSSProperties = { gridTemplateColumns: template(tracks.cols), gridTemplateRows: template(tracks.rows) }
  const place = (id: string): CSSProperties => { const i = order.indexOf(id); return { gridColumn: 2 * (i % cols) + 1, gridRow: 2 * Math.floor(i / cols) + 1 } }
  const evenOut = () => { const next = { ...sizes }; delete next[shape]; setSizes(next); write(storageKey, next) }
  const reset = () => { evenOut(); setOrder([]) }
  const resize = (axis: 'cols' | 'rows', k: number, e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !stageRef.current) return
    e.preventDefault()
    endResize.current?.()
    const el = e.currentTarget, rect = stageRef.current.getBoundingClientRect()
    const start = axis === 'cols' ? e.clientX : e.clientY, base = tracks[axis]
    const sum = base.reduce((a, b) => a + b, 0), pair = base[k] + base[k + 1]
    const pixels = (axis === 'cols' ? rect.width : rect.height) - 6 * (base.length - 1) - 16
    let latest = tracks
    el.setPointerCapture(e.pointerId)
    const move = (event: globalThis.PointerEvent) => {
      let first = base[k] + ((axis === 'cols' ? event.clientX : event.clientY) - start) / Math.max(1, pixels) * sum
      if (Math.abs(first - pair / 2) / sum * pixels < 10) first = pair / 2
      first = Math.max(pair * .1, Math.min(pair * .9, first))
      const values = [...base]; values[k] = first; values[k + 1] = pair - first
      latest = { ...tracks, [axis]: values }
      setSizes(current => ({ ...current, [shape]: latest }))
    }
    const finish = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish)
      endResize.current = null
      setSizes(current => { const next = { ...current, [shape]: latest }; write(storageKey, next); return next })
    }
    endResize.current = finish
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
  }
  const gutters = <>{(['cols', 'rows'] as const).flatMap(axis => tracks[axis].slice(1).map((_, k) => <div key={`${axis}${k}`} role="separator" aria-label={`Resize ${axis === 'cols' ? 'columns' : 'rows'}`} aria-orientation={axis === 'cols' ? 'vertical' : 'horizontal'} className={`grid-gutter ${axis === 'cols' ? 'col' : 'row'}`} style={axis === 'cols' ? { gridColumn: 2 * k + 2, gridRow: '1 / -1' } : { gridRow: 2 * k + 2, gridColumn: '1 / -1' }} onPointerDown={e => resize(axis, k, e)} onDoubleClick={evenOut} title="Drag to resize; snaps to equal sizes. Double-click to even out." />))}</>
  const handle = (id: string) => <button className="panel-drag-handle" draggable title="Drag to move. Drop in center to swap, at an edge to insert. Alt + arrow keys moves this panel." aria-label="Move panel" onDragStart={e => { e.dataTransfer.setData('application/x-mc-panel', id); e.dataTransfer.effectAllowed = 'move'; setSource(id) }} onDragEnd={() => { setSource(null); setDrop(null) }} onKeyDown={e => {
    if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault(); e.stopPropagation()
    const offset = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols
    const target = order[order.indexOf(id) + offset]
    if (target) setOrder(arrangePanels(order, id, target, 'swap'))
  }}><GripVertical size={14} /></button>
  const target = (id: string) => ({
    'data-drop': drop?.id === id ? drop.mode : undefined,
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!source || source === id) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height
      setDrop({ id, mode: x < .22 || y < .18 ? 'before' : x > .78 || y > .82 ? 'after' : 'swap' })
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null) },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!source || drop?.id !== id) return
      e.preventDefault(); setOrder(arrangePanels(order, source, id, drop.mode)); setSource(null); setDrop(null)
    }
  })
  return { stageRef, style, place, gutters, handle, target, reset }
}
