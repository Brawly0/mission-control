import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, FolderOpen, Pencil, Star, Terminal } from 'lucide-react'
import type { Project } from '@shared/types'
import { moveProject, orderedProjects } from '@shared/projectOrder'
import { useToast } from '../toast'
import { errorMessage } from '../util'
import IdentityDialog from './IdentityDialog'

export function useProjectActions(projects: Project[], onChanged: () => void, onOpen: (path: string) => void, onTerminal: (p: Project) => void, grouped = false, visible = projects) {
  const toast = useToast()
  const [rename, setRename] = useState<Project | null>(null)
  const [menu, setMenu] = useState<{ project: Project; x: number; y: number } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const section = (p: Project) => p.pinned ? 'pinned' : `group:${p.meta.group ?? ''}`
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const close = (e: globalThis.MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null) }
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    const hide = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    window.addEventListener('resize', hide)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape); window.removeEventListener('resize', hide) }
  }, [menu])
  const run = async (action: () => Promise<unknown>) => {
    try { await action(); onChanged() } catch (e) { toast('error', 'Could not update project', errorMessage(e)) }
  }
  const move = async (source: string, target: string, after = false) => {
    if (busy.current) return
    busy.current = true
    await run(() => window.mc.reorderProjects(moveProject(orderedProjects(projects).map(p => p.path), source, target, after)))
    busy.current = false
  }
  const show = (project: Project, e: MouseEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation()
    setMenu({ project, x: e.clientX, y: e.clientY })
  }
  const events = (p: Project) => ({
    'data-project-path': p.path,
    draggable: true,
    onContextMenu: (e: MouseEvent<HTMLElement>) => show(p, e),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault(); const r = e.currentTarget.getBoundingClientRect()
        setMenu({ project: p, x: r.left + 12, y: r.top + 24 })
      }
    },
    onDragStart: (e: DragEvent<HTMLElement>) => { setMenu(null); e.dataTransfer.setData('application/x-mc-project', p.path); e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e: DragEvent<HTMLElement>) => { if (e.dataTransfer.types.includes('application/x-mc-project')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(p.path) } },
    onDragLeave: () => setDragOver(null),
    onDragEnd: () => setDragOver(null),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault(); setDragOver(null)
      const source = e.dataTransfer.getData('application/x-mc-project')
      if (!projects.some(p => p.path === source)) return
      if (grouped && section(projects.find(p => p.path === source)!) !== section(p)) {
        toast('info', 'Drag within a project section', 'Pin or change the project group to move it to another section.')
        return
      }
      const r = e.currentTarget.getBoundingClientRect()
      void move(source, p.path, e.clientY > r.top + r.height / 2)
    },
    'data-drop-target': dragOver === p.path || undefined
  })
  const sorted = orderedProjects(visible).filter(p => !grouped || !menu || section(p) === section(menu.project))
  const index = menu ? sorted.findIndex(p => p.path === menu.project.path) : -1
  const items = menu ? [
    { label: 'Open project', icon: FolderOpen, action: () => onOpen(menu.project.path) },
    { label: 'Rename project', icon: Pencil, action: () => setRename(menu.project) },
    { label: menu.project.pinned ? 'Unpin project' : 'Pin project', icon: Star, action: () => void run(() => window.mc.togglePin(menu.project.path)) },
    { label: 'Open terminal here', icon: Terminal, action: () => onTerminal(menu.project) },
    { label: 'Show in Explorer', icon: FolderOpen, action: () => void run(() => window.mc.openInExplorer(menu.project.path)) },
    { label: 'Move up', icon: ArrowUp, disabled: index <= 0, action: () => void move(menu.project.path, sorted[index - 1].path) },
    { label: 'Move down', icon: ArrowDown, disabled: index >= sorted.length - 1, action: () => void move(menu.project.path, sorted[index + 1].path, true) }
  ] : []
  const overlay = <>
    {rename && <IdentityDialog project={rename} onClose={() => setRename(null)} onSaved={onChanged} />}
    {menu && createPortal(<div ref={menuRef} className="menu project-context-menu" role="menu" aria-label={`Actions for ${menu.project.name}`} style={{ position: 'fixed', left: Math.max(8, Math.min(menu.x, window.innerWidth - 280)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 310)), zIndex: 1500 }}>
      {items.map(item => <button key={item.label} className="menu-item" role="menuitem" disabled={item.disabled} onClick={() => { item.action(); setMenu(null) }}><item.icon size={14} />{item.label}</button>)}
    </div>, document.body)}
  </>
  return { events, overlay, show }
}
