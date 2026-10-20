import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
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

export interface MenuItem {
  label: string
  icon?: LucideIcon
  hint?: string
  onSelect: () => void
  disabled?: boolean
}

/** A button that opens a small dropdown menu. */
export function MenuButton({ trigger, items, align = 'left' }: { trigger: (open: () => void) => ReactNode; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="menu-anchor" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={`menu menu-${align}`} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              className="menu-item"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.icon && <item.icon size={15} strokeWidth={1.9} />}
              <span className="menu-label">
                {item.label}
                {item.hint && <span className="menu-hint">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)} title={o.label}>
          {o.icon && <o.icon size={14} strokeWidth={2} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}
