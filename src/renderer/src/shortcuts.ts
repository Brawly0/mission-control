import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Every keyboard shortcut in one place. App handles the global ones; the rest are broadcast as an
 * "mc:shortcut" window event and handled by whichever visible view owns them (project tabs, chats…).
 * Users can rebind any of them in Settings → Shortcuts (stored as AppSettings.keybindings).
 */

export type ShortcutGroup = 'General' | 'Go to' | 'Project' | 'Agents' | 'Tasks' | 'Chats' | 'View'

export interface ShortcutDef {
  id: string
  label: string
  group: ShortcutGroup
  /** Default key combinations, e.g. ["Ctrl+K", "Ctrl+Shift+P"]. */
  keys: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'palette', label: 'Command palette', group: 'General', keys: ['Ctrl+K', 'Ctrl+Shift+P'] },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'General', keys: ['Ctrl+/', 'F1'] },
  { id: 'settings', label: 'Settings', group: 'General', keys: ['Ctrl+,'] },
  { id: 'refresh', label: 'Refresh projects', group: 'General', keys: ['F5'] },
  { id: 'addProject', label: 'Add a project folder', group: 'General', keys: ['Ctrl+O'] },
  { id: 'notifications', label: 'Turn notifications on or off', group: 'General', keys: ['Ctrl+Shift+M'] },

  { id: 'goHome', label: 'Home', group: 'Go to', keys: ['Ctrl+1'] },
  { id: 'goAgents', label: 'Agents', group: 'Go to', keys: ['Ctrl+2'] },
  { id: 'goTasks', label: 'Task board', group: 'Go to', keys: ['Ctrl+3'] },
  { id: 'goSearch', label: 'Search all chats', group: 'Go to', keys: ['Ctrl+Shift+F', 'Ctrl+4'] },
  { id: 'goUsage', label: 'Usage and cost', group: 'Go to', keys: ['Ctrl+5'] },
  { id: 'goProject', label: 'Current project', group: 'Go to', keys: ['Ctrl+6'] },
  { id: 'goProjects', label: 'All projects', group: 'Go to', keys: ['Ctrl+7'] },
  { id: 'goNotebook', label: 'Notebook', group: 'Go to', keys: ['Ctrl+8'] },
  { id: 'goKnowledge', label: 'Knowledge (all docs)', group: 'Go to', keys: ['Ctrl+9'] },
  { id: 'prevProject', label: 'Previous project', group: 'Go to', keys: ['Alt+Up'] },
  { id: 'nextProject', label: 'Next project', group: 'Go to', keys: ['Alt+Down'] },

  { id: 'newSession', label: 'New Claude session', group: 'Project', keys: ['Ctrl+N'] },
  { id: 'quickChat', label: 'Quick chat (temporary folder)', group: 'Project', keys: ['Ctrl+Alt+N'] },
  { id: 'newProject', label: 'New project', group: 'Project', keys: ['Ctrl+Shift+O'] },
  { id: 'newWorktreeSession', label: 'New session in a worktree', group: 'Project', keys: ['Ctrl+Shift+N'] },
  { id: 'continueLast', label: 'Continue last chat', group: 'Project', keys: ['Ctrl+Shift+R'] },
  { id: 'powershell', label: 'PowerShell in project', group: 'Project', keys: ['Ctrl+Shift+`'] },
  { id: 'tabOverview', label: 'Overview tab', group: 'Project', keys: ['Alt+O'] },
  { id: 'tabChats', label: 'Chats tab', group: 'Project', keys: ['Alt+C'] },
  { id: 'tabChanges', label: 'Changes tab', group: 'Project', keys: ['Alt+G'] },
  { id: 'tabDocs', label: 'Docs tab', group: 'Project', keys: ['Alt+D'] },
  { id: 'pinProject', label: 'Pin or unpin project', group: 'Project', keys: ['Ctrl+D'] },
  { id: 'nameIcon', label: 'Change name and icon', group: 'Project', keys: ['Ctrl+I'] },
  { id: 'openExplorer', label: 'Open in Explorer', group: 'Project', keys: ['Ctrl+Alt+E'] },
  { id: 'openVSCode', label: 'Open in VS Code', group: 'Project', keys: ['Ctrl+Alt+V'] },
  { id: 'openTerminal', label: 'Open Claude in Windows Terminal', group: 'Project', keys: ['Ctrl+Alt+T'] },

  { id: 'chatFilter', label: 'Search this project’s chats', group: 'Chats', keys: ['Ctrl+F'] },
  { id: 'chatNext', label: 'Next chat', group: 'Chats', keys: ['Alt+J'] },
  { id: 'chatPrev', label: 'Previous chat', group: 'Chats', keys: ['Alt+K'] },
  { id: 'chatResume', label: 'Resume selected chat', group: 'Chats', keys: ['Ctrl+Enter'] },
  { id: 'chatRename', label: 'Rename selected chat', group: 'Chats', keys: ['F2'] },

  { id: 'nextAgent', label: 'Next agent', group: 'Agents', keys: ['Ctrl+Tab'] },
  { id: 'prevAgent', label: 'Previous agent', group: 'Agents', keys: ['Ctrl+Shift+Tab'] },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `agent${n}`, label: `Agent ${n}`, group: 'Agents' as const, keys: [`Alt+${n}`] })),
  { id: 'closeAgent', label: 'Close agent', group: 'Agents', keys: ['Ctrl+Shift+W'] },
  { id: 'toggleGrid', label: 'Tabs or grid', group: 'Agents', keys: ['Ctrl+Shift+G'] },
  { id: 'toggleReview', label: 'Review panel (diff)', group: 'Agents', keys: ['Ctrl+Shift+D'] },
  { id: 'compactAgent', label: 'Compact agent’s chat', group: 'Agents', keys: ['Ctrl+Shift+K'] },
  { id: 'renameAgent', label: 'Rename agent', group: 'Agents', keys: ['Ctrl+Shift+E'] },

  { id: 'newTask', label: 'New task', group: 'Tasks', keys: ['Ctrl+T'] },
  { id: 'newNote', label: 'New note', group: 'Tasks', keys: ['Ctrl+Shift+J'] },
  { id: 'templates', label: 'Templates and schedules', group: 'Tasks', keys: ['Ctrl+Shift+T'] },
  { id: 'toggleQueue', label: 'Auto-run queue on or off', group: 'Tasks', keys: ['Ctrl+Shift+Q'] },

  { id: 'toggleSidebar', label: 'Show or hide sidebar', group: 'View', keys: ['Ctrl+B'] },
  { id: 'toggleTheme', label: 'Light or dark theme', group: 'View', keys: ['Ctrl+Shift+L'] },
  { id: 'zoomIn', label: 'Zoom in', group: 'View', keys: ['Ctrl+='] },
  { id: 'zoomOut', label: 'Zoom out', group: 'View', keys: ['Ctrl+-'] },
  { id: 'zoomReset', label: 'Reset zoom', group: 'View', keys: ['Ctrl+0'] },
  { id: 'toggleWorktrees', label: 'Show worktrees and scratch folders', group: 'View', keys: ['Ctrl+Shift+H'] }
]

const NAMED: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  '+': '=',
  _: '-'
}

/** "Ctrl+Shift+K" for a key event, or '' for a lone modifier. Uses the physical key for digits and symbols so Shift doesn't change them. */
export function comboFromEvent(e: KeyboardEvent): string {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return ''
  let key = e.key
  const code = e.code
  if (/^Digit\d$/.test(code)) key = code.slice(5)
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (code === 'Backquote') key = '`'
  else if (code === 'Slash') key = '/'
  else if (code === 'Comma') key = ','
  else if (code === 'Equal') key = '='
  else if (code === 'Minus') key = '-'
  key = NAMED[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+')
}

/**
 * Whether a shortcut may fire where the key was pressed. In a terminal, plain Ctrl+letter belongs to
 * the shell and Claude (Ctrl+C, Ctrl+R…), so only Alt, Ctrl+Shift and F-key shortcuts fire there,
 * plus Ctrl+Tab. In a text field, keys without Ctrl or Alt type text.
 */
export function allowedIn(combo: string, target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  const fkey = /(^|\+)F\d+$/.test(combo)
  if (el?.closest?.('.terminal-host')) {
    // Terminals can't send Ctrl+digit, Ctrl+= or Ctrl+- anyway, so those are safe to take.
    return fkey || combo.includes('Alt+') || combo.startsWith('Ctrl+Shift+') || /^Ctrl\+(Tab|\d|=|-)$/.test(combo)
  }
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  if (typing) {
    // Editing keys stay with the field: Ctrl+A/C/V/X/Z, Ctrl+Enter in forms, and arrows.
    if (/^Ctrl\+(A|C|V|X|Z|Y|Enter|Left|Right|Backspace|Delete)$/.test(combo) || combo === 'F2') return false
    return fkey || combo.includes('Ctrl+') || combo.includes('Alt+')
  }
  return true
}

/** Current bindings: your own (from Settings) over the defaults. '' unbinds. */
export function effectiveKeys(overrides: Record<string, string> | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const s of SHORTCUTS) {
    const own = overrides?.[s.id]
    out.set(s.id, own === undefined ? s.keys : own ? [own] : [])
  }
  return out
}

/** Which shortcut a combination triggers. */
export function bindingIndex(keys: Map<string, string[]>): Map<string, string> {
  const idx = new Map<string, string>()
  for (const [id, combos] of keys) for (const c of combos) if (!idx.has(c)) idx.set(c, id)
  return idx
}

/** Another shortcut already using this combination, if any. */
export function conflictFor(keys: Map<string, string[]>, id: string, combo: string): ShortcutDef | undefined {
  for (const [other, combos] of keys) if (other !== id && combos.includes(combo)) return SHORTCUTS.find((s) => s.id === other)
  return undefined
}

export const ShortcutContext = createContext<Map<string, string[]>>(effectiveKeys(undefined))

/** The first key combination for an action, for tooltips and menus ('' if unbound). */
export function useKeyFor(): (id: string) => string {
  const keys = useContext(ShortcutContext)
  return (id) => keys.get(id)?.[0] ?? ''
}

/** "Label (Ctrl+N)" for a tooltip. */
export function withKey(label: string, combo: string): string {
  return combo ? `${label} (${combo})` : label
}

/** Runs \`handler\` when one of \`ids\` is triggered and \`active\` is true (e.g. the view is visible). */
export function useShortcutEvent(ids: string[], handler: (id: string) => void, active = true): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (ids.includes(id)) ref.current(id)
    }
    window.addEventListener('mc:shortcut', on)
    return () => window.removeEventListener('mc:shortcut', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ids.join('|')])
}
