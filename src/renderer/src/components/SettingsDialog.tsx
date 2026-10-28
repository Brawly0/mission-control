import { useEffect, useState } from 'react'
import { Download, Keyboard, Leaf, ListTodo, Minus, Monitor, Moon, Palette, PiggyBank, Plus, RefreshCw, Settings2, Sun, X } from 'lucide-react'
import type { AppSettings, EcoSettings, UpdateState } from '@shared/types'
import { Button, IconButton, Segmented } from './ui'
import { SHORTCUTS, effectiveKeys } from '../shortcuts'
import { KeyCombo } from './ShortcutsDialog'

type Tab = 'general' | 'appearance' | 'tasks' | 'spending' | 'shortcuts' | 'updates'
const TABS: { id: Tab; label: string; icon: typeof Keyboard }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'spending', label: 'Spending', icon: PiggyBank },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'updates', label: 'Updates', icon: Download }
]

function AppearanceSection({ settings, apply }: { settings: AppSettings; apply: (p: Partial<AppSettings>) => void }) {
  const zoom = settings.uiZoom || 1
  const setZoom = (z: number) => apply({ uiZoom: Math.round(Math.min(1.6, Math.max(0.7, z)) * 10) / 10 })
  return (
    <>
      <div className="field">
        <span className="field-label">Theme</span>
        <Segmented
          value={settings.theme}
          options={[
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'system', label: 'Same as Windows', icon: Monitor }
          ]}
          onChange={(theme) => apply({ theme })}
        />
        <span className="field-hint">Terminals stay dark in both themes, so Claude’s colors read the same.</span>
      </div>
      <div className="field">
        <span className="field-label">Zoom</span>
        <div className="zoom-row">
          <IconButton icon={Minus} label="Zoom out" onClick={() => setZoom(zoom - 0.1)} />
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <IconButton icon={Plus} label="Zoom in" onClick={() => setZoom(zoom + 0.1)} />
          {zoom !== 1 && (
            <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
              Reset
            </Button>
          )}
        </div>
        <span className="field-hint">Makes everything bigger or smaller, terminals included. Shortcuts: Ctrl+= and Ctrl+-, Ctrl+0 to reset.</span>
      </div>
    </>
  )
}

function ShortcutsSection({ onOpen, overrides }: { onOpen?: () => void; overrides: Record<string, string> }) {
  const keys = effectiveKeys(overrides)
  const highlights = ['palette', 'goHome', 'newSession', 'newTask', 'nextAgent', 'toggleSidebar', 'shortcuts']
  return (
    <div className="field">
      <span className="field-label">Keyboard shortcuts</span>
      <p className="small muted">
        There are {SHORTCUTS.length} shortcuts, for going places, starting sessions and tasks, switching agents, and changing the view. You can change any of them.
      </p>
      <ul className="shortcut-highlights">
        {highlights.map((id) => (
          <li key={id}>
            <span>{SHORTCUTS.find((s) => s.id === id)?.label}</span>
            <KeyCombo combo={keys.get(id)?.[0] ?? ''} />
          </li>
        ))}
      </ul>
      <Button variant="primary" icon={Keyboard} onClick={onOpen}>
        See and change all shortcuts
      </Button>
    </div>
  )
}

/** Turns a keydown into an Electron accelerator like "Ctrl+Alt+M". */
function accelerator(e: React.KeyboardEvent): string | null {
  const key = e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  if (mods.length === 0) return null
  const name = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key
  return [...mods, name].join('+')
}

function updateText(u: UpdateState | null): string {
  if (!u) return ''
  switch (u.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'none':
      return 'You have the latest version.'
    case 'available':
      return `Version ${u.version} found, downloading…`
    case 'downloading':
      return `Downloading ${u.version}… ${u.percent ?? 0}%`
    case 'ready':
      return `Version ${u.version} is ready. Restart to install it.`
    case 'error':
      return `Couldn't check for updates: ${u.message}`
    case 'disabled':
      return u.message ?? 'Updates are off.'
    default:
      return ''
  }
}

function UpdatesSection({ autoUpdate, onAutoUpdate }: { autoUpdate: boolean; onAutoUpdate: (v: boolean) => void }) {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateState | null>(null)
  useEffect(() => {
    window.mc.appVersion().then(setVersion)
    window.mc.updateStatus().then(setStatus)
    return window.mc.onUpdateStatus(setStatus)
  }, [])
  return (
    <div className="field updates">
      <span className="field-label">Updates</span>
      <div className="update-row">
        <span>
          Mission Control <strong>{version}</strong>
        </span>
        {status?.state === 'ready' ? (
          <Button size="sm" variant="primary" icon={Download} onClick={() => window.mc.installUpdate()}>
            Restart and update
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => window.mc.checkForUpdates()} disabled={status?.state === 'disabled' || status?.state === 'checking'}>
            Check now
          </Button>
        )}
      </div>
      <span className={`field-hint ${status?.state === 'error' ? 'warn' : ''}`}>{updateText(status)}</span>
      <label className="check-row">
        <input type="checkbox" checked={autoUpdate} onChange={(e) => onAutoUpdate(e.target.checked)} />
        <span>
          Check for updates automatically
          <span className="field-hint block">Checks every 30 minutes and when you come back to the window. New versions download in the background; an Update button in the top bar restarts into them (or they install the next time Mission Control restarts).</span>
        </span>
      </label>
    </div>
  )
}

export default function SettingsDialog({ onClose, onOpenShortcuts, initialTab }: { onClose: () => void; onOpenShortcuts?: () => void; initialTab?: Tab }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.mc.getSettings().then(setSettings)
  }, [])

  const apply = async (patch: Partial<AppSettings>) => {
    const err = await window.mc.setSettings(patch)
    setError(err)
    if (!err) {
      setSettings((s) => (s ? { ...s, ...patch } : s))
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog settings" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => !recording && e.key === 'Escape' && onClose()}>
        <div className="dialog-head">
          <h2>Settings</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        {!settings ? (
          <div className="muted pad">Loading…</div>
        ) : (
          <div className="settings-layout">
            <nav className="settings-tabs">
              {TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                  <t.icon size={15} /> {t.label}
                </button>
              ))}
            </nav>
          <div className="dialog-body settings-pane" data-settings-tab={tab}>
            {tab === 'general' && (<>
            <section className="settings-section" aria-labelledby="settings-profile">
            <h3 id="settings-profile">Profile</h3>
            <label className="field">
              <span className="field-label">Your name</span>
              <input
                className="text-input"
                placeholder="Your first name, for the greeting on Home"
                value={settings.userName ?? ''}
                onChange={(e) => setSettings({ ...settings, userName: e.target.value })}
                onBlur={() => apply({ userName: settings.userName ?? '' })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <span className="field-hint">Leave empty to use the first name of your Windows account.</span>
            </label>
            </section>
            <section className="settings-section" aria-labelledby="settings-notifications">
            <h3 id="settings-notifications">Notifications</h3>
            <label className="check-row">
              <input type="checkbox" checked={settings.autoBriefings} onChange={(e) => apply({ autoBriefings: e.target.checked })} />
              <span>
                Save a session briefing whenever a chat runs out of room
                <span className="field-hint block">Claude Code writes a summary when it compacts a chat. Mission Control saves it to the project’s docs/briefings/ folder, so a new session can start from it (New session → from latest briefing).</span>
              </span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={!!settings.digestTime} onChange={(e) => apply({ digestTime: e.target.checked ? '09:00' : '' })} />
              <span>
                Daily digest at{' '}
                <input
                  type="time"
                  className="text-input time-input"
                  value={settings.digestTime || '09:00'}
                  disabled={!settings.digestTime}
                  onChange={(e) => e.target.value && apply({ digestTime: e.target.value })}
                />
                <span className="field-hint block">A notification with yesterday in review (chats, share of your week, tasks) and what’s waiting today. If the app isn’t running then, it shows when you next open it. The Inbox always has it.</span>
              </span>
            </label>
            </section>
            <section className="settings-section" aria-labelledby="settings-window">
            <h3 id="settings-window">Window</h3>
            <div className="field">
              <span className="field-label">Global shortcut to show or hide Mission Control</span>
              <div className="hotkey-row">
                <button
                  className={`hotkey-box ${recording ? 'recording' : ''}`}
                  onClick={() => setRecording(true)}
                  onBlur={() => setRecording(false)}
                  onKeyDown={(e) => {
                    if (!recording) return
                    e.preventDefault()
                    if (e.key === 'Escape') return setRecording(false)
                    const acc = accelerator(e)
                    if (acc) {
                      setRecording(false)
                      apply({ hotkey: acc })
                    }
                  }}
                >
                  <Keyboard size={14} />
                  {recording ? 'Press the keys…' : settings.hotkey || 'Not set'}
                </button>
                <Button size="sm" variant="ghost" onClick={() => apply({ hotkey: '' })} disabled={!settings.hotkey}>
                  Turn off
                </Button>
              </div>
              <span className="field-hint">Works from any app. Use at least one of Ctrl, Alt or Shift.</span>
              {error && <span className="field-hint warn">{error}</span>}
            </div>
            <label className="check-row">
              <input type="checkbox" checked={settings.closeToTray} onChange={(e) => apply({ closeToTray: e.target.checked })} />
              <span>
                Keep running in the tray when I close the window
                <span className="field-hint block">Only while agents or tasks are running. Quit from the tray icon's menu.</span>
              </span>
            </label>
            </section>
            </>)}
            {tab === 'tasks' && (<>
            <div className="field">
              <span className="field-label">Auto-run queue</span>
              <label className="inline-field">
                Hold the queue while my plan usage is at or above
                <input
                  className="text-input num-input"
                  type="number"
                  min={0}
                  max={100}
                  value={settings.queuePauseAtPercent}
                  onChange={(e) => setSettings({ ...settings, queuePauseAtPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  onBlur={() => apply({ queuePauseAtPercent: settings.queuePauseAtPercent })}
                />
                %
              </label>
              <span className="field-hint">Uses the 5-hour and 7-day limits Claude Code reports. Also skips recurring tasks and holds chains. 0 turns the check off.</span>
            </div>

            <div className="field">
              <span className="field-label">Default budget for headless tasks</span>
              <label className="inline-field">
                Stop a task that doesn’t set its own budget after spending $
                <input
                  className="text-input num-input"
                  type="number"
                  min={0}
                  step={0.5}
                  value={settings.defaultTaskBudgetUsd}
                  onChange={(e) => setSettings({ ...settings, defaultTaskBudgetUsd: Math.max(0, Number(e.target.value) || 0) })}
                  onBlur={() => apply({ defaultTaskBudgetUsd: settings.defaultTaskBudgetUsd })}
                />
              </label>
              <span className="field-hint">Estimated at API prices, per run (follow-ups get their own allowance). 0 means no default limit. Monthly budgets per project are in each project’s Overview tab.</span>
            </div>

            <div className="field">
              <span className="field-label">Default model for tasks</span>
              <select
                className="select"
                value={settings.defaultTaskModel}
                onChange={(e) => {
                  setSettings({ ...settings, defaultTaskModel: e.target.value })
                  apply({ defaultTaskModel: e.target.value })
                }}
              >
                <option value="">Claude’s default</option>
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
              <span className="field-hint">For tasks that don’t pick a model, unless their project has its own default (Overview → Spending). Sonnet or Haiku costs far less for routine work like reviews and small fixes.</span>
            </div>

            </>)}
            {tab === 'spending' && (<>
            <EcoFields eco={settings.eco} onChange={(patch) => {
              const eco = { ...settings.eco, ...patch }
              setSettings({ ...settings, eco })
              apply({ eco })
            }} />

            <div className="field">
              <span className="field-label">Expensive chat alert</span>
              <label className="inline-field">
                Notify me when one chat has cost more than $
                <input
                  className="text-input num-input"
                  type="number"
                  min={0}
                  step={5}
                  value={settings.chatCostAlertUsd}
                  onChange={(e) => setSettings({ ...settings, chatCostAlertUsd: Math.max(0, Number(e.target.value) || 0) })}
                  onBlur={() => apply({ chatCostAlertUsd: settings.chatCostAlertUsd })}
                />
                today
              </label>
              <span className="field-hint">Once per chat per day, estimated at API prices. 0 turns it off.</span>
            </div>

            <div className="field">
              <span className="field-label">Plan limit alert</span>
              <label className="inline-field">
                Notify me when my session or weekly limit passes
                <input
                  className="text-input num-input"
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.planAlertPercent}
                  onChange={(e) => setSettings({ ...settings, planAlertPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  onBlur={() => apply({ planAlertPercent: settings.planAlertPercent })}
                />
                %
              </label>
              <span className="field-hint">Once per window, plus once when a limit runs out. The meters in the top bar update every few minutes. 0 turns it off.</span>
            </div>

            <div className="field">
              <span className="field-label">Large chat warning</span>
              <label className="inline-field">
                Mark a live chat amber at
                <input
                  className="text-input num-input"
                  type="number"
                  min={20}
                  step={50}
                  value={Math.round(settings.contextWarnTokens / 1000)}
                  onChange={(e) => setSettings({ ...settings, contextWarnTokens: Math.max(20, Number(e.target.value) || 0) * 1000 })}
                  onBlur={() => apply({ contextWarnTokens: settings.contextWarnTokens })}
                />
                K tokens
              </label>
              <span className="field-hint">Every reply re-reads the whole chat, so cost per reply grows with its size. The agent shows a Compact button to shrink it.</span>
            </div>

            </>)}
            {tab === 'appearance' && <AppearanceSection settings={settings} apply={apply} />}
            {tab === 'shortcuts' && <ShortcutsSection onOpen={onOpenShortcuts} overrides={settings.keybindings ?? {}} />}
            {tab === 'updates' && <UpdatesSection autoUpdate={settings.autoUpdate} onAutoUpdate={(v) => apply({ autoUpdate: v })} />}
            {saved && <div className="muted small">Saved</div>}
          </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Eco mode: one switch, and what it changes in the chats and tasks Mission Control starts. */
export function EcoFields({ eco, onChange }: { eco: EcoSettings; onChange: (patch: Partial<EcoSettings>) => void }) {
  return (
    <div className={`eco-fields ${eco.enabled ? 'on' : ''}`}>
      <label className="eco-switch">
        <input type="checkbox" checked={eco.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        <Leaf size={15} />
        <span>
          <span className="strong">Eco mode</span>
          <span className="field-hint">Uses less of your plan in the chats and tasks Mission Control starts. Chats already running keep their settings until you restart them.</span>
        </span>
      </label>
      <div className="eco-grid">
        <label>
          <span className="field-label">Model</span>
          <select className="select" value={eco.model} disabled={!eco.enabled} onChange={(e) => onChange({ model: e.target.value })}>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
            <option value="">Claude’s default</option>
          </select>
          <span className="field-hint">For new chats and tasks with no model of their own. A project’s default model still wins. Type /model opus in a chat when you need it.</span>
        </label>
        <label>
          <span className="field-label">Effort</span>
          <select className="select" value={eco.effort} disabled={!eco.enabled} onChange={(e) => onChange({ effort: e.target.value as EcoSettings['effort'] })}>
            <option value="">Claude’s default</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <span className="field-hint">How hard Claude thinks before answering. Lower is cheaper and faster; keep the default for tricky work.</span>
        </label>
        <label>
          <span className="field-label">Compact chats at</span>
          <select className="select" value={eco.autocompactTokens} disabled={!eco.enabled} onChange={(e) => onChange({ autocompactTokens: Number(e.target.value) })}>
            <option value={100000}>100k tokens</option>
            <option value={150000}>150k tokens</option>
            <option value={200000}>200k tokens</option>
            <option value={0}>Claude’s default</option>
          </select>
          <span className="field-hint">Every reply re-reads the whole chat, so compacting sooner is the biggest saving on long chats.</span>
        </label>
      </div>
      <label className="inline-check">
        <input type="checkbox" checked={eco.coach} disabled={!eco.enabled} onChange={(e) => onChange({ coach: e.target.checked })} />
        Coach long chats: when a chat reaches 60% and 85% of that size, or your session limit is nearly used up, Claude is told once to suggest compacting or a fresh chat at a good moment
      </label>
      <label className="inline-check">
        <input type="checkbox" checked={eco.skill} disabled={!eco.enabled} onChange={(e) => onChange({ skill: e.target.checked })} />
        Load the eco:coach skill (lean working habits; type /eco:coach for advice on the current chat)
      </label>
    </div>
  )
}
