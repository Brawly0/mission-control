import { BellOff, CircleAlert, Database, Download, GitBranch, Radio } from 'lucide-react'
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
}

/** Only what's happening or needs you: working agents, agents waiting, updates, indexing, the branch, notifications off. */
export default function StatusBar({ view, project, git, agents, notify, indexStatus, update, onToggleNotify, onShowAttention }: Props) {
  const live = agents.filter((a) => !a.exited)
  const working = live.filter((a) => a.hookStatus === 'working').length
  const attention = live.filter((a) => a.hookStatus === 'needs-input').length
  return (
    <footer className="statusbar">
      {working > 0 && (
        <span className="sb-item" title={`${live.length} agent${live.length === 1 ? '' : 's'} open`}>
          <Radio size={12} /> {working} working
        </span>
      )}
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
      {indexStatus && (indexStatus.indexing || indexStatus.error) && (
        <span className="sb-item" title={indexStatus.error ? `Last index error: ${indexStatus.error}` : 'Indexing chats for search and usage'}>
          <Database size={12} />
          {indexStatus.indexing ? `Indexing ${indexStatus.done}/${indexStatus.total}` : 'Index problem'}
        </span>
      )}
      {view === 'project' && project && git?.isRepo && (
        <span className="sb-item">
          <GitBranch size={12} /> {git.branch}
          {!!git.dirty && ` · ${git.dirty} changed`}
        </span>
      )}
      {!notify && (
        <button className="sb-item sb-button" onClick={onToggleNotify} title="Desktop notifications are off. Click to turn them on.">
          <BellOff size={12} /> Notifications off
        </button>
      )}
    </footer>
  )
}
