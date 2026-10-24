import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, X } from 'lucide-react'
import { errorMessage } from '../util'
import { Button, IconButton } from './ui'

/** Creates a new project folder (with a starter CLAUDE.md and git if you like), or adds an existing one. */
export default function NewProjectDialog({ onClose, onCreated, onAddExisting }: { onClose: () => void; onCreated: (path: string) => void; onAddExisting: () => void }) {
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [claudeMd, setClaudeMd] = useState(true)
  const [git, setGit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.mc.commonFolders().then((f) => setParent((cur) => cur || f.desktop))
  }, [])

  const create = async () => {
    if (!name.trim() || !parent) return
    setBusy(true)
    setError(null)
    try {
      const path = await window.mc.createProject({ parent, name: name.trim(), claudeMd, git })
      onCreated(path)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog new-project" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dialog-head">
          <h2>
            <FolderPlus size={16} /> New project
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">
          <label className="field">
            <span className="field-label">Name</span>
            <input className="text-input" autoFocus placeholder="e.g. my-new-app" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
          </label>
          <div className="field">
            <span className="field-label">Location</span>
            <div className="inline-field">
              <span className="text-input mono path-box" title={parent}>
                {parent}
                {name.trim() && <span className="muted">\{name.trim()}</span>}
              </span>
              <Button
                size="sm"
                icon={FolderOpen}
                onClick={async () => {
                  const p = await window.mc.pickFolder('Where should the project folder go?')
                  if (p) setParent(p)
                }}
              >
                Change
              </Button>
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={claudeMd} onChange={(e) => setClaudeMd(e.target.checked)} />
            <span>
              Add a starter CLAUDE.md
              <span className="field-hint block">A short file where you tell Claude what the project is and how to work on it.</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} />
            <span>
              Turn on git
              <span className="field-hint block">So tasks can run in their own worktrees and you can review and merge their changes.</span>
            </span>
          </label>
          {error && <div className="run-error">{error}</div>}
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" className="foot-left" onClick={onAddExisting}>
            Add an existing folder instead…
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={FolderPlus} disabled={busy || !name.trim()} onClick={() => void create()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  )
}
