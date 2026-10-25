import { useState } from 'react'
import { FolderOpen, LayoutGrid, Rows2, Save, Trash2, X } from 'lucide-react'
import type { Workspace } from '@shared/types'
import type { Agent } from '../types'
import { timeAgo } from '../util'
import { Avatar, Button, IconButton } from './ui'

interface Props {
  workspaces: Workspace[]
  /** Agents open now (what Save stores). */
  agents: Agent[]
  layout: 'tabs' | 'grid'
  onSave: (name: string, replaceId?: string) => void
  onOpen: (ws: Workspace) => void
  onDelete: (id: string) => void
  onClose: () => void
}

/** Save the open agents as a named workspace, and open, update or delete saved ones. */
export default function WorkspacesDialog({ workspaces, agents, layout, onSave, onOpen, onDelete, onClose }: Props) {
  const projects = [...new Set(agents.map((a) => a.projectName))]
  const [name, setName] = useState(() => (projects.length === 1 ? projects[0] : ''))
  const existing = workspaces.find((w) => w.name.trim().toLowerCase() === name.trim().toLowerCase())
  const save = () => name.trim() && agents.length && onSave(name.trim(), existing?.id)

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog workspaces" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dialog-head">
          <h2>
            <LayoutGrid size={16} /> Workspaces
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">
          <div className="field">
            <span className="field-label">
              Save the {agents.length} open {agents.length === 1 ? 'agent' : 'agents'} ({layout === 'grid' ? 'grid' : 'tabs'})
            </span>
            <div className="workspace-save">
              <input
                className="text-input"
                autoFocus
                placeholder="Name, e.g. Bot: daily review"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
              <Button variant="primary" icon={Save} disabled={!name.trim() || !agents.length} onClick={save}>
                {existing ? 'Replace' : 'Save'}
              </Button>
            </div>
            <span className="field-hint">
              {agents.length
                ? 'Opening it later resumes each chat where it left off (chats with no prompt yet start fresh in the same folder).'
                : 'Open some agents first.'}
            </span>
          </div>

          <span className="field-label">Saved</span>
          {workspaces.length === 0 && <p className="muted small">None yet.</p>}
          <ul className="workspace-list">
            {workspaces.map((w) => (
              <li key={w.id}>
                <div className="workspace-avatars">
                  {[...new Map(w.agents.map((a) => [a.projectPath ?? a.cwd, a])).values()].slice(0, 3).map((a) => (
                    <Avatar key={a.projectPath ?? a.cwd} name={a.projectName} path={a.projectPath ?? a.cwd} size={20} />
                  ))}
                </div>
                <div className="workspace-text">
                  <span className="strong ellipsis">{w.name}</span>
                  <span className="muted small ellipsis" title={w.agents.map((a) => a.title).join('\n')}>
                    {w.layout === 'grid' ? <LayoutGrid size={11} /> : <Rows2 size={11} />} {w.agents.length} {w.agents.length === 1 ? 'agent' : 'agents'} · saved {timeAgo(w.updatedAt)}
                  </span>
                </div>
                <Button size="sm" variant="primary" icon={FolderOpen} onClick={() => onOpen(w)}>
                  Open
                </Button>
                <IconButton icon={Save} label={`Replace with the ${agents.length} open agents`} size={14} disabled={!agents.length} onClick={() => onSave(w.name, w.id)} />
                <IconButton icon={Trash2} label="Delete" size={14} onClick={() => onDelete(w.id)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
