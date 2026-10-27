import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ChevronDown, ChevronUp, Play, Plus, Terminal, X } from 'lucide-react'
import type { Project, WorktreeInfo } from '@shared/types'
import type { LaunchOptions } from '../types'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import { Button, IconButton } from './ui'

const TerminalPane = lazy(() => import('./TerminalPane'))
const RunPanel = lazy(() => import('./RunPanel'))
export interface DockContext { cwd: string; name: string; project?: Project; worktree?: WorktreeInfo }
export interface DockRequest { tab: 'terminal' | 'run'; nonce: number }
interface DockTerminal { id: string; cwd: string; name: string; exited: boolean; exitCode?: number }
const key = (path: string) => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
const clampHeight = (height: number) => {
  const body = document.querySelector('.view-body')?.getBoundingClientRect().height
  const dock = document.querySelector('.bottom-dock')?.getBoundingClientRect().height
  // Leave usable room above the dock, including wrapped toolbars on small windows.
  const available = body && dock ? body + dock - 300 : window.innerHeight * 0.55
  return Math.max(160, Math.min(height, 540, window.innerHeight * 0.55, available))
}
function preferences() {
  try {
    const p = JSON.parse(localStorage.getItem('mc.bottomDock') || '{}')
    return { open: p.open === true, tab: p.tab === 'run' ? 'run' as const : 'terminal' as const, height: clampHeight(Number.isFinite(p.height) ? p.height : 300) }
  } catch { return { open: false, tab: 'terminal' as const, height: clampHeight(300) } }
}

/** Owns shell PTYs separately from agents; each PTY has exactly one mounted xterm. */
export default function BottomDock({ context, request, visible, onChanged, onLaunch }: { context?: DockContext; request?: DockRequest; visible: boolean; onChanged: () => void; onLaunch: (opts: LaunchOptions) => void }) {
  const toast = useToast()
  const [initial] = useState(preferences)
  const [open, setOpen] = useState(initial.open)
  const [tab, setTab] = useState<'terminal' | 'run'>(initial.tab)
  const [height, setHeight] = useState(initial.height)
  const [terminals, setTerminals] = useState<DockTerminal[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [runVisited, setRunVisited] = useState(false)
  const seenRequest = useRef<number | undefined>(undefined)
  const starting = useRef(new Set<string>())
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals
  const contextRef = useRef(context)
  contextRef.current = context
  const active = terminals.find(t => t.id === activeId)
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem('mc.bottomDock', JSON.stringify({ open, tab, height })) } catch {} }, 200)
    return () => clearTimeout(timer)
  }, [open, tab, height])
  useEffect(() => { if (open && tab === 'run') setRunVisited(true) }, [open, tab])
  useEffect(() => { if (visible && open) setHeight(h => clampHeight(h)) }, [visible, open, context?.cwd])
  useEffect(() => {
    setActiveId(terminalsRef.current.find(t => context && key(t.cwd) === key(context.cwd) && !t.exited)?.id ?? null)
  }, [context?.cwd])
  useEffect(() => {
    const resize = () => setHeight(h => clampHeight(h))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => () => { terminalsRef.current.forEach(t => { if (!t.exited) window.mc.ptyKill(t.id) }) }, [])
  const ensureTerminal = async (force = false) => {
    const ctx = contextRef.current
    if (!ctx) return
    const existing = terminalsRef.current.find(t => key(t.cwd) === key(ctx.cwd) && !t.exited)
    if (existing && !force) { setActiveId(existing.id); return }
    const cwdKey = key(ctx.cwd)
    if (starting.current.has(cwdKey)) return
    starting.current.add(cwdKey); setPending(starting.current.size)
    try {
      const info = await window.mc.ptySpawn({ cwd: ctx.cwd, kind: 'shell', args: [], cols: 100, rows: 16 })
      const count = terminalsRef.current.filter(t => key(t.cwd) === cwdKey).length + 1
      setTerminals(list => [...list, { id: info.id, cwd: ctx.cwd, name: `${ctx.name} · ${count}`, exited: false }])
      if (contextRef.current && key(contextRef.current.cwd) === cwdKey) setActiveId(info.id)
    } catch (e) { toast('error', 'Could not open terminal', errorMessage(e)) }
    finally { starting.current.delete(cwdKey); setPending(starting.current.size) }
  }
  useEffect(() => {
    if (!request || !context || seenRequest.current === request.nonce) return
    seenRequest.current = request.nonce
    setOpen(true); setTab(request.tab)
    if (request.tab === 'terminal') void ensureTerminal()
  }, [request, context?.cwd]) // a request starts once, even if project metadata refreshes
  const selectTab = (next: 'terminal' | 'run') => {
    setTab(next); setOpen(true)
    if (next === 'terminal') void ensureTerminal()
  }
  const close = (id: string) => {
    window.mc.ptyKill(id)
    setTerminals(list => list.filter(t => t.id !== id))
    if (activeId === id) setActiveId(null)
  }
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId)
    const el = e.currentTarget, start = e.clientY, original = height
    const move = (event: globalThis.PointerEvent) => setHeight(clampHeight(original + start - event.clientY))
    const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
  }
  return <section className={`bottom-dock ${open ? 'is-open' : 'is-collapsed'}`} aria-label="Project tools" style={{ display: visible ? undefined : 'none', height: open ? height : 38 }}>
    {open && <div className="dock-resizer" role="separator" aria-label="Resize project tools" aria-orientation="horizontal" tabIndex={0} onPointerDown={startResize} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setHeight(h => clampHeight(h + (e.key === 'ArrowUp' ? 24 : -24))) } }} />}
    <header className="bottom-dock-head">
      <div className="bottom-dock-tabs" role="tablist" aria-label="Project tools">
        <button role="tab" aria-selected={open && tab === 'terminal'} onClick={() => selectTab('terminal')}><Terminal size={14} /> Terminal{terminals.length > 0 && <span className="tab-count">{terminals.length}</span>}</button>
        <button role="tab" aria-selected={open && tab === 'run'} onClick={() => selectTab('run')} disabled={!context?.project}><Play size={13} /> Run</button>
      </div>
      <span className="dock-folder mono ellipsis" title={tab === 'terminal' && active ? active.cwd : context?.cwd}>{tab === 'terminal' && active ? active.cwd : context?.cwd ?? 'Select a project'}</span>
      {open && tab === 'terminal' && <>
        {terminals.length > 0 && <select className="select select-sm dock-terminal-picker" aria-label="Dock terminal" value={activeId ?? ''} onChange={e => setActiveId(e.target.value || null)}><option value="">Choose terminal</option>{terminals.map(t => <option key={t.id} value={t.id}>{t.name}{t.exited ? ' · exited' : ''}</option>)}</select>}
        <IconButton icon={Plus} label="New dock terminal in current folder" disabled={!context || pending > 0} onClick={() => void ensureTerminal(true)} />
        {active && <IconButton icon={X} label="Close dock terminal and stop its process" onClick={() => close(active.id)} />}
      </>}
      <IconButton icon={open ? ChevronDown : ChevronUp} label={open ? 'Collapse project tools' : 'Expand project tools'} onClick={() => { setOpen(!open); if (!open && tab === 'terminal') void ensureTerminal() }} />
    </header>
    <div className="bottom-dock-body" style={{ display: open ? undefined : 'none' }}>
      <div className="dock-terminal-stage" style={{ display: tab === 'terminal' ? undefined : 'none' }}>
        {!active && <div className="dock-empty"><Terminal size={21} /><span>{pending ? 'Starting PowerShell…' : 'Open a terminal in the folder shown above.'}</span><Button size="sm" disabled={!context || pending > 0} onClick={() => void ensureTerminal()}>Open terminal</Button></div>}
        {terminals.map(t => <div key={t.id} className={`dock-terminal-pane ${t.id !== activeId ? 'stacked-hidden' : ''}`} data-terminal-id={t.id}><Suspense fallback={<div className="muted pad">Loading terminal…</div>}><TerminalPane id={t.id} visible={visible && open && tab === 'terminal' && t.id === activeId} onExit={code => setTerminals(list => list.map(item => item.id === t.id ? { ...item, exited: true, exitCode: code } : item))} /></Suspense></div>)}
      </div>
      {runVisited && context?.project && <div className="dock-run-stage" style={{ display: tab === 'run' ? undefined : 'none' }}><Suspense fallback={<div className="muted pad">Loading commands…</div>}><RunPanel key={`${context.project.path}:${context.cwd}`} project={context.project} cwd={context.cwd} worktree={context.worktree} onChanged={onChanged} onLaunch={onLaunch} /></Suspense></div>}
    </div>
  </section>
}
