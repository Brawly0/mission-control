import { useEffect, useState } from 'react'
import { Download, Keyboard, RefreshCw, X } from 'lucide-react'
import type { AppSettings, UpdateState } from '@shared/types'
import { Button, IconButton } from './ui'

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
          <span className="field-hint block">New versions download in the background and install the next time Mission Control restarts.</span>
        </span>
      </label>
    </div>
  )
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
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
          <div className="dialog-body">
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
              <span className="field-hint">Uses the 5-hour and 7-day limits Claude Code reports. 0 turns the check off.</span>
            </div>

            <UpdatesSection autoUpdate={settings.autoUpdate} onAutoUpdate={(v) => apply({ autoUpdate: v })} />
            {saved && <div className="muted small">Saved</div>}
          </div>
        )}
      </div>
    </div>
  )
}
