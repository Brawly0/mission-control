import { ChevronDown, FolderPlus, ListPlus, MessageSquareDashed, Moon, NotebookPen, Play, Plus, Search, Settings, Sun } from 'lucide-react'
import type { RateLimitInfo } from '@shared/types'
import { useKeyFor, withKey } from '../shortcuts'
import { initials } from '../util'
import { KeyCombo } from './ShortcutsDialog'
import PlanMeter from './PlanMeter'
import { IconButton, MenuButton } from './ui'

interface Props {
  theme: 'dark' | 'light'
  userName: string
  /** Name of the project "New session" starts in. */
  currentProject?: string
  rateLimit: RateLimitInfo | null
  onShortcut: (id: string) => void
}

/** Search, plan limits, the New menu, theme, settings and you, across the top of every page. */
export default function TopBar({ theme, userName, currentProject, rateLimit, onShortcut }: Props) {
  const keyFor = useKeyFor()
  return (
    <header className="topbar">
      <button className="topbar-search" onClick={() => onShortcut('palette')}>
        <Search size={16} />
        <span>Search projects, chats, tasks…</span>
        {keyFor('palette') && <KeyCombo combo={keyFor('palette')} />}
      </button>
      <PlanMeter info={rateLimit} onOpen={() => onShortcut('goUsage')} />
      <div className="topbar-actions">
        <MenuButton
          align="right"
          trigger={(toggle) => (
            <button className="btn btn-primary btn-md topbar-new" onClick={toggle}>
              <Plus size={16} />
              <span>New</span>
              <ChevronDown size={14} />
            </button>
          )}
          items={[
            { label: currentProject ? `Session in ${currentProject}` : 'Session', hint: keyFor('newSession'), icon: Play, onSelect: () => onShortcut('newSession') },
            { label: 'Task', hint: keyFor('newTask'), icon: ListPlus, onSelect: () => onShortcut('newTask') },
            { label: 'Project', hint: keyFor('newProject'), icon: FolderPlus, onSelect: () => onShortcut('newProject') },
            { label: 'Quick chat', hint: keyFor('quickChat'), icon: MessageSquareDashed, onSelect: () => onShortcut('quickChat') },
            { label: 'Note', hint: keyFor('newNote'), icon: NotebookPen, onSelect: () => onShortcut('newNote') }
          ]}
        />
        <IconButton icon={theme === 'dark' ? Sun : Moon} label={withKey(theme === 'dark' ? 'Light theme' : 'Dark theme', keyFor('toggleTheme'))} size={18} onClick={() => onShortcut('toggleTheme')} />
        <IconButton icon={Settings} label={withKey('Settings', keyFor('settings'))} size={18} onClick={() => onShortcut('settings')} />
        <button className="topbar-avatar" title={userName ? `${userName} · Settings` : 'Add your name in Settings'} onClick={() => onShortcut('settings')}>
          {userName ? initials(userName) : '?'}
        </button>
      </div>
    </header>
  )
}
