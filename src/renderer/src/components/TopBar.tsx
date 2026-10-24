import { ChevronDown, FolderPlus, Leaf, ListPlus, MessageSquareDashed, Moon, NotebookPen, Play, Plus, Search, Settings, Sun } from 'lucide-react'
import type { EcoSettings, RateLimitInfo } from '@shared/types'
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
  eco?: EcoSettings
  /** Opens Settings → Spending, where Eco mode's details are. */
  onEcoSettings: () => void
  onShortcut: (id: string) => void
}

/** Search, plan limits, the New menu, theme, settings and you, across the top of every page. */
export default function TopBar({ theme, userName, currentProject, rateLimit, eco, onEcoSettings, onShortcut }: Props) {
  const keyFor = useKeyFor()
  const ecoTip = eco?.enabled
    ? [
        'Eco mode is on. New chats and tasks:',
        eco.model ? `· use ${eco.model[0].toUpperCase()}${eco.model.slice(1)} unless they pick a model` : '',
        eco.effort ? `· think at ${eco.effort} effort` : '',
        eco.autocompactTokens ? `· compact at ${Math.round(eco.autocompactTokens / 1000)}k tokens` : '',
        eco.coach ? '· get coached when they grow long' : '',
        eco.skill ? '· have the eco:coach skill' : '',
        'Click to turn off · right-click for settings'
      ]
        .filter(Boolean)
        .join('\n')
    : 'Eco mode is off. Click to use less of your plan in new chats and tasks · right-click for settings'
  return (
    <header className="topbar">
      <button className="topbar-search" onClick={() => onShortcut('palette')}>
        <Search size={16} />
        <span>Search projects, chats, tasks…</span>
        {keyFor('palette') && <KeyCombo combo={keyFor('palette')} />}
      </button>
      <button
        className={`eco-toggle ${eco?.enabled ? 'on' : ''}`}
        title={withKey(ecoTip, keyFor('toggleEco'))}
        onClick={() => onShortcut('toggleEco')}
        onContextMenu={(e) => {
          e.preventDefault()
          onEcoSettings()
        }}
      >
        <Leaf size={15} />
        <span>Eco</span>
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
