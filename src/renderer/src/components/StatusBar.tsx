import { Bell, BellOff, CircleAlert, Database, Download, GitBranch, Radio, Settings } from 'lucide-react'
import type { GitInfo, IndexStatus, Project, UpdateState } from '@shared/types'
import type { Agent, View } from '../types'

interface Props {
  view: View
  project: Project | null
  git?: GitInfo
  agents: Agent[]
  notify: boolean
  indexStatus: IndexStatus | null
  update: UpdateState
  onToggleNotify: () => void
  onShowAttention: () => void
  onOpenSettings: () => void
}

export default function StatusBar({ view, project, git, agents, notify, indexStatus, update, onToggleNotify, onShowAttention, onOpenSettings }: Props) {
  const live = agents.filter((a) => !a.exited)
  const attention = live.filter((a) => a.hookStatus === 'needs-input').length
  return (
    <footer className="statusbar">
      <span className="sb-item" title="Agents running">
        <Radio size={12} /> {live.length} running
      </span>
      {attention > 0 && (
        <button className="sb-item sb-attention" onClick={onShowAttention}>
          <CircleAlert size={12} /> {attention} {attention === 1 ? 'needs' : 'need'} you
        </button>
      )}
      <span className="sb-spacer" />
      {update.state === 'ready' && (
        <button className="sb-item sb-update" onClick={() => window.mc.installUpdate()} title="Restarts Mission Control into the new version">
          <Download size={12} /> Update {update.version} ready · Restart
        </button>
      )}
      {update.state === 'downloading' && (
        <span className="sb-item" title="Downloading the new version in the background">
          <Download size={12} /> Downloading {update.version} {update.percent !== undefined ? `${update.percent}%` : ''}
        </span>
      )}
      {indexStatus && (
        <span className="sb-item" title={indexStatus.error ? `Last index error: ${indexStatus.error}` : 'Chats indexed for search and usage'}>
          <Database size={12} />
          {indexStatus.indexing ? `Indexing ${indexStatus.done}/${indexStatus.total}` : `${indexStatus.sessions} chats indexed`}
        </span>
      )}
      {view === 'project' && project && git?.isRepo && (
        <span className="sb-item">
          <GitBranch size={12} /> {git.branch}
          {!!git.dirty && ` · ${git.dirty} changed`}
        </span>
      )}
      <button className="sb-item sb-button" onClick={onToggleNotify} title={notify ? 'Notifications on' : 'Notifications off'}>
        {notify ? <Bell size={12} /> : <BellOff size={12} />}
        {notify ? 'Notifications on' : 'Notifications off'}
      </button>
      <button className="sb-item sb-button" onClick={onOpenSettings} title="Settings (hotkey, tray)">
        <Settings size={12} />
      </button>
    </footer>
  )
}
