import { Bell, BellOff, CircleAlert, GitBranch, Radio } from 'lucide-react'
import type { GitInfo, Project } from '@shared/types'
import type { Agent, View } from '../types'

interface Props {
  view: View
  project: Project | null
  git?: GitInfo
  agents: Agent[]
  notify: boolean
  onToggleNotify: () => void
  onShowAttention: () => void
}

export default function StatusBar({ view, project, git, agents, notify, onToggleNotify, onShowAttention }: Props) {
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
      <span className="sb-item muted">Ctrl K</span>
    </footer>
  )
}
