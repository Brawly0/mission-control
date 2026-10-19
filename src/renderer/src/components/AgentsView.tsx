import { useState } from 'react'
import type { Agent, AgentLayout } from '../types'
import { displayStatus } from '../agentStatus'
import TerminalPane from './TerminalPane'

interface Props {
  agents: Agent[]
  activeId: string | null
  layout: AgentLayout
  visible: boolean
  lastOutput: Record<string, number>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onExit: (id: string, code: number) => void
  onLayout: (layout: AgentLayout) => void
  onNew: () => void
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
  const { agents, activeId, layout, visible, lastOutput, onSelect, onClose, onRename, onExit, onLayout, onNew } = props

  if (agents.length === 0) {
    return (
      <div className="empty">
        <p>No agents running.</p>
        <button className="btn primary" onClick={onNew}>
          ▶ Start a Claude session in the selected project
        </button>
      </div>
    )
  }

  const cols = Math.ceil(Math.sqrt(agents.length))
  return (
    <div className="agents">
      <div className="agent-tabs">
        {agents.map((a) => {
          const st = displayStatus(a, lastOutput[a.id])
          return (
            <div
              key={a.id}
              className={`agent-tab ${a.id === activeId ? 'active' : ''} ${st.cls === 'needs-input' ? 'attention' : ''}`}
              onClick={() => onSelect(a.id)}
              title={`${a.cwd}\n${st.label}`}
            >
              <span className={`dot ${st.cls}`} />
              <TabTitle agent={a} onRename={(t) => onRename(a.id, t)} />
              <button
                className="close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(a.id)
                }}
                title="Close (stops the process)"
              >
                ×
              </button>
            </div>
          )
        })}
        <button className="icon-btn" onClick={onNew} title="New session in selected project">
          ＋
        </button>
        <div className="spacer" />
        <div className="segmented">
          <button className={layout === 'tabs' ? 'active' : ''} onClick={() => onLayout('tabs')}>
            Tabs
          </button>
          <button className={layout === 'grid' ? 'active' : ''} onClick={() => onLayout('grid')}>
            Grid
          </button>
        </div>
      </div>
      <div
        className={`agent-stage ${layout}`}
        style={layout === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {agents.map((a) => {
          const shown = layout === 'grid' || a.id === activeId
          const st = displayStatus(a, lastOutput[a.id])
          return (
            <div
              key={a.id}
              className={`agent-cell ${shown ? '' : 'stacked-hidden'} ${a.id === activeId ? 'focused' : ''} ${st.cls === 'needs-input' ? 'attention' : ''}`}
              onMouseDown={() => onSelect(a.id)}
            >
              {layout === 'grid' && (
                <div className="agent-cell-header">
                  <span className={`dot ${st.cls}`} />
                  <TabTitle agent={a} onRename={(t) => onRename(a.id, t)} />
                  <span className="muted small status-label">{st.label}</span>
                </div>
              )}
              <TerminalPane
                id={a.id}
                visible={visible && shown && a.id === activeId}
                onExit={(code) => onExit(a.id, code)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
