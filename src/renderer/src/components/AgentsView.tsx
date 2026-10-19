import { useState } from 'react'
import { Bot, GitBranch, GitCompareArrows, LayoutGrid, Plus, Rows2, Terminal, X } from 'lucide-react'
import type { GitInfo } from '@shared/types'
import type { Agent, AgentLayout } from '../types'
import { displayStatus } from '../agentStatus'
import { elapsed } from '../util'
import TerminalPane from './TerminalPane'
import ChangesPanel from './ChangesPanel'
import { Avatar, Button, EmptyState, IconButton, Segmented } from './ui'

interface Props {
  agents: Agent[]
  activeId: string | null
  layout: AgentLayout
  visible: boolean
  lastOutput: Record<string, number>
  git: Record<string, GitInfo>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onExit: (id: string, code: number) => void
  onLayout: (layout: AgentLayout) => void
  onNew: () => void
  onGitChanged: () => void
}

function TabTitle({ agent, onRename }: { agent: Agent; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null) {
    return (
      <span className="agent-tab-title" onDoubleClick={() => setDraft(agent.title)} title="Double-click to rename">
        {agent.title}
      </span>
    )
  }
  const commit = () => {
    const t = draft.trim()
    if (t) onRename(t)
    setDraft(null)
  }
  return (
    <input
      className="tab-rename"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
        e.stopPropagation()
      }}
    />
  )
}

export default function AgentsView(props: Props) {
  const { agents, activeId, layout, visible, lastOutput, git, onSelect, onClose, onRename, onExit, onLayout, onNew } = props
  const [reviewOpen, setReviewOpen] = useState(false)

  if (agents.length === 0) {
    return (
      <EmptyState icon={Bot} title="No agents running">
        <p>Start Claude in a project and it runs here, live. Run several side by side in a grid.</p>
        <Button variant="primary" icon={Plus} onClick={onNew}>
          New session in current project
        </Button>
      </EmptyState>
    )
  }

  const active = agents.find((a) => a.id === activeId) ?? agents[0]
  const reviewable = (a: Agent) => Boolean(a.worktree || git[a.projectPath]?.isRepo)
  const showReview = reviewOpen && reviewable(active)
  const cols = Math.ceil(Math.sqrt(agents.length))

  return (
    <div className="agents">
      <div className="agent-bar">
        <div className="agent-tabs">
          {agents.map((a) => {
            const st = displayStatus(a, lastOutput[a.id])
            return (
              <div
                key={a.id}
                className={`agent-tab ${a.id === active.id ? 'active' : ''} ${st.cls === 'needs-input' ? 'attention' : ''}`}
                onClick={() => onSelect(a.id)}
                title={`${a.cwd}\n${st.label}`}
              >
                <span className={`dot ${st.cls}`} />
                {a.kind === 'shell' && <Terminal size={12} className="muted" />}
                {a.worktree && <GitBranch size={12} className="tone-accent" />}
                <TabTitle agent={a} onRename={(t) => onRename(a.id, t)} />
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(a.id)
                  }}
                  title="Close (stops the process)"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
          <IconButton icon={Plus} label="New session in current project" size={15} onClick={onNew} />
        </div>
        <div className="agent-bar-end">
          <Button
            size="sm"
            variant={showReview ? 'secondary' : 'ghost'}
            icon={GitCompareArrows}
            disabled={!reviewable(active)}
            title={reviewable(active) ? 'Review this agent’s changes' : 'Not a git repository'}
            onClick={() => setReviewOpen((o) => !o)}
            className={showReview ? 'is-on' : ''}
          >
            Review
          </Button>
          <Segmented<AgentLayout>
            value={layout}
            onChange={onLayout}
            options={[
              { value: 'tabs', label: 'Tabs', icon: Rows2 },
              { value: 'grid', label: 'Grid', icon: LayoutGrid }
            ]}
          />
        </div>
      </div>

      <div className={`agent-workspace ${showReview ? 'with-review' : ''}`}>
        <div className={`agent-stage ${layout}`} style={layout === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
          {agents.map((a) => {
            const shown = layout === 'grid' || a.id === active.id
            const st = displayStatus(a, lastOutput[a.id])
            return (
              <div
                key={a.id}
                className={`agent-cell ${shown ? '' : 'stacked-hidden'} ${a.id === active.id ? 'focused' : ''} status-${st.cls}`}
                onMouseDown={() => onSelect(a.id)}
              >
                <div className="agent-cell-head">
                  <Avatar name={a.projectName} size={20} />
                  <span className="strong ellipsis">{layout === 'grid' ? a.title : a.projectName}</span>
                  {a.worktree ? (
                    <span className="chip chip-accent" title={a.worktree.path}>
                      <GitBranch size={11} /> {a.worktree.branch}
                    </span>
                  ) : (
                    git[a.projectPath]?.isRepo && (
                      <span className="chip">
                        <GitBranch size={11} /> {git[a.projectPath].branch}
                      </span>
                    )
                  )}
                  <span className={`status-pill status-${st.cls}`}>
                    <span className={`dot ${st.cls}`} />
                    <span className="ellipsis">{st.label}</span>
                  </span>
                  <span className="muted small agent-elapsed">{elapsed(a.startedAt)}</span>
                </div>
                <TerminalPane id={a.id} visible={visible && shown && a.id === active.id} onExit={(code) => onExit(a.id, code)} />
              </div>
            )
          })}
        </div>
        {showReview && (
          <aside className="review-panel">
            <ChangesPanel
              key={active.id}
              path={active.worktree?.path ?? active.cwd}
              worktree={active.worktree}
              visible={visible}
              onChanged={props.onGitChanged}
              onDiscarded={() => {
                setReviewOpen(false)
                onClose(active.id)
              }}
              onClose={() => setReviewOpen(false)}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

