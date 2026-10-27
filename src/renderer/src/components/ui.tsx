import { createPortal } from 'react-dom'
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { LoaderCircle } from 'lucide-react'
import { avatarHue, initials } from '../util'
import { ICONS, useLook } from '../projectLook'
import type { ProjectIcon } from '@shared/projectLook'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: LucideIcon
  iconRight?: LucideIcon
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, children, className = '', ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2} />}
      {children && <span>{children}</span>}
      {IconRight && <IconRight size={13} strokeWidth={2} className="btn-icon-right" />}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  active?: boolean
  size?: number
}

export function IconButton({ icon: Icon, label, active, size = 16, className = '', ...rest }: IconButtonProps) {
  return (
    <button className={`icon-btn ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} {...rest}>
      <Icon size={size} strokeWidth={1.9} />
    </button>
  )
}

/**
 * A project's badge: its icon in its color when the project is known (by path or name),
 * else its initials. `icon`/`hue` override, e.g. for the live preview in the icon picker.
 */
export function Avatar({ name, path, size = 28, icon, hue: hueProp }: { name: string; path?: string; size?: number; icon?: ProjectIcon; hue?: number }) {
  const lookUp = useLook()
  const look = lookUp(path) ?? lookUp(name)
  const hue = hueProp ?? look?.hue ?? avatarHue(name)
  const Icon = ICONS[icon ?? look?.icon ?? 'Folder']
  const showIcon = !!(icon ?? look?.icon)
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${hue} 45% 22%)`,
        color: `hsl(${hue} 80% 78%)`,
        borderColor: `hsl(${hue} 45% 32%)`
      }}
    >
      {showIcon ? <Icon size={Math.round(size * 0.56)} strokeWidth={size < 20 ? 2.2 : 1.9} /> : initials(name)}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'attention' | 'success' | 'info'; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  )
}

export function LoadingState({ children = 'Loading…' }: { children?: ReactNode }) {
  return <div className="loading-state" role="status"><LoaderCircle size={16} aria-hidden="true" /><span>{children}</span></div>
}

export interface MenuItem {
  id?: string
  label: string
  icon?: LucideIcon
  hint?: string
  onSelect: () => void
  disabled?: boolean
}

/** Shared menus escape clipped panes, fit the viewport and support keyboard navigation. */
export function MenuButton({ trigger, items, align = 'left', portal = true }: { portal?: boolean; trigger: (open: () => void) => ReactNode; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const firstFocus = useRef<'first' | 'last'>('first')
  const id = useId()
  const control = () => ref.current?.querySelector<HTMLButtonElement>('button')
  const enabled = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  const dismiss = (restoreFocus = false) => { setOpen(false); if (restoreFocus) control()?.focus() }

  useLayoutEffect(() => {
    if (!open) { setPosition(p => p.visibility === 'hidden' ? p : { visibility: 'hidden' }); return }
    const place = () => {
      if (!portal || !ref.current || !menuRef.current) return
      const anchor = ref.current.getBoundingClientRect()
      const width = Math.min(300, window.innerWidth - 16)
      const below = window.innerHeight - anchor.bottom - 12, above = anchor.top - 12
      const desired = Math.min(420, menuRef.current.scrollHeight + 2)
      const goesAbove = below < desired && above > below
      const maxHeight = Math.max(40, Math.min(420, goesAbove ? above : below))
      const height = Math.min(desired, maxHeight)
      setPosition({ position: 'fixed', width, minWidth: 0, maxHeight, zIndex: 1000,
        top: goesAbove ? Math.max(8, anchor.top - height - 4) : anchor.bottom + 4,
        left: Math.max(8, Math.min(align === 'right' ? anchor.right - width : anchor.left, window.innerWidth - width - 8)), right: 'auto' })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, portal, align, items.length])

  useLayoutEffect(() => {
    if (!open || (portal && position.visibility === 'hidden') || menuRef.current?.contains(document.activeElement)) return
    const options = enabled()
    ;(firstFocus.current === 'last' ? options.at(-1) : options[0])?.focus()
  }, [open, portal, position])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) dismiss()
    }
    const scroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) dismiss() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(true) } }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])

  const button = trigger(() => { firstFocus.current = 'first'; setOpen(o => !o) })
  const accessibleButton = isValidElement(button) ? cloneElement(button as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>, {
    'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
    onKeyDown: e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); firstFocus.current = e.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true)
      }
    }
  }) : button
  const menu = open && (
    <div id={id} ref={menuRef} className={`menu menu-${align}`} role="menu" style={portal ? position : undefined}
      onKeyDown={e => {
        const options = enabled(), index = options.indexOf(document.activeElement as HTMLButtonElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); e.stopPropagation()
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
          options[next]?.focus()
        } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(true) }
        else if (e.key === 'Tab') dismiss(true)
      }}>
      {items.map((item) => (
        <button type="button" key={item.id ?? item.label} className="menu-item" role="menuitem" tabIndex={-1} disabled={item.disabled}
          onClick={() => { dismiss(true); item.onSelect() }}>
          {item.icon && <item.icon size={15} strokeWidth={1.9} />}
          <span className="menu-label">{item.label}{item.hint && <span className="menu-hint">{item.hint}</span>}</span>
        </button>
      ))}
    </div>
  )
  return (
    <div className="menu-anchor" ref={ref}>
      {accessibleButton}
      {portal ? createPortal(menu, document.body) : menu}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)} title={o.label}>
          {o.icon && <o.icon size={14} strokeWidth={2} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Which agent a chat or terminal belongs to; shown where Claude and Codex appear side by side (ADR 0020). */
export function ToolBadge({ tool, title }: { tool: 'claude' | 'codex'; title?: string }) {
  return (
    <span className={`tool-badge tool-${tool}`} title={title ?? (tool === 'codex' ? 'Codex (OpenAI)' : 'Claude Code')}>
      {tool === 'codex' ? 'Codex' : 'Claude'}
    </span>
  )
}
