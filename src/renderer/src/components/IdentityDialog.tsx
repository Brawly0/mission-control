import { useState } from 'react'
import { Palette, RotateCcw, X } from 'lucide-react'
import type { Project } from '@shared/types'
import { PROJECT_HUES, PROJECT_ICONS, type ProjectIcon } from '@shared/projectLook'
import { ICONS } from '../projectLook'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import { Avatar, Button, IconButton } from './ui'

/** Rename a project and pick its icon and color. Only Mission Control sees these; the folder isn't renamed. */
export default function IdentityDialog({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(project.meta.displayName ?? '')
  const [icon, setIcon] = useState<ProjectIcon>(project.icon)
  const [hue, setHue] = useState(project.hue)
  const [busy, setBusy] = useState(false)
  // What the name would be without your own: the README title or the folder name.
  const automaticName = project.meta.displayName ? project.folderName : project.name

  const save = async (patch: { displayName: string; icon: ProjectIcon | null; hue: number | null }) => {
    setBusy(true)
    try {
      // null clears your choice, so the automatic one comes back.
      await window.mc.setProjectMeta(project.path, patch as never)
      onSaved()
      onClose()
    } catch (e) {
      toast('error', 'Could not save', errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog identity" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dialog-head">
          <h2>
            <Palette size={16} /> Name and icon
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">
          <div className="identity-preview">
            <Avatar name={name || automaticName} size={48} icon={icon} hue={hue} />
            <div>
              <div className="identity-name">{name.trim() || automaticName}</div>
              <div className="muted small mono">{project.path}</div>
            </div>
          </div>

          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="text-input"
              autoFocus
              value={name}
              placeholder={automaticName}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save({ displayName: name, icon, hue })}
            />
            <span className="field-hint">Leave empty to use “{automaticName}”. The folder itself keeps its name.</span>
          </label>

          <div className="field">
            <span className="field-label">Icon</span>
            <div className="icon-grid">
              {PROJECT_ICONS.map((key) => {
                const Icon = ICONS[key]
                return (
                  <button key={key} className={`icon-choice ${icon === key ? 'selected' : ''}`} title={key} aria-label={key} onClick={() => setIcon(key)}>
                    <Icon size={18} strokeWidth={1.9} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Color</span>
            <div className="hue-row">
              {PROJECT_HUES.map((h) => (
                <button
                  key={h}
                  className={`hue-choice ${hue === h ? 'selected' : ''}`}
                  style={{ background: `hsl(${h} 45% 22%)`, color: `hsl(${h} 80% 78%)`, borderColor: `hsl(${h} 45% 40%)` }}
                  aria-label={`Color ${h}`}
                  onClick={() => setHue(h)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => save({ displayName: '', icon: null, hue: null })} className="foot-left">
            Use automatic
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => save({ displayName: name, icon, hue })}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
