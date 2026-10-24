import { ChevronDown, Download, FolderPlus, Leaf, Loader2, ListPlus, MessageSquareDashed, Moon, NotebookPen, Play, Plus, Search, Settings, Sun } from 'lucide-react'
import type { EcoSettings, RateLimitInfo, UpdateState } from '@shared/types'
import { useState } from 'react'
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
  update: UpdateState
  /** Opens Settings → Spending, where Eco mode's details are. */
  onEcoSettings: () => void
  onShortcut: (id: string) => void
}

/** Search, plan limits, the New menu, theme, settings and you, across the top of every page. */
/** Shows when a new version is out: one click downloads it (if needed) and restarts into it. */
function UpdateButton({ update }: { update: UpdateState }) {
  const [pressed, setPressed] = useState(false)
  if (update.state !== 'available' && update.state !== 'downloading' && update.state !== 'ready') return null
  const busy = pressed && update.state !== 'ready'
  const label =
    update.state === 'ready'
      ? `Restart to update`
      : pressed
        ? `Updating${update.state === 'downloading' && update.percent !== undefined ? ` ${update.percent}%` : '…'}`
        : `Update to ${update.version}`
  return (
    <button
      className={`update-btn ${update.state === 'ready' ? 'ready' : ''}`}
      disabled={busy}
      title={
        update.state === 'ready'
          ? `Mission Control ${update.version} is downloaded. Click to restart into it; open agents are offered for restore.`
          : `Mission Control ${update.version} is out. Click to download it and restart as soon as it's ready.`
      }
      onClick={() => {
        setPressed(true)
        window.mc.updateNow()
      }}
    >
      {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
      <span>{label}</span>
    </button>
  )
}

export default function TopBar({ theme, userName, currentProject, rateLimit, eco, update, onEcoSettings, onShortcut }: Props) {
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
      <UpdateButton update={update} />
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
