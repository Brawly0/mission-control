import type { Agent, AgentLayout } from '../types'
import TerminalPane from './TerminalPane'

interface Props {
  agents: Agent[]
  activeId: string | null
  layout: AgentLayout
  visible: boolean
  lastOutput: Record<string, number>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onExit: (id: string, code: number) => void
  onLayout: (layout: AgentLayout) => void
  onNew: () => void
}

/** Output in the last few seconds means the agent is busy; silence means it is idle or waiting for you. */
const WORKING_MS = 2500

function status(agent: Agent, last: number | undefined): { cls: string; label: string } {
  if (agent.exited) return { cls: 'exited', label: `exited (${agent.exitCode ?? '?'})` }
  if (last && Date.now() - last < WORKING_MS) return { cls: 'working', label: 'working' }
  return { cls: 'idle', label: 'idle / waiting' }
}

export default function AgentsView(props: Props) {
  const { agents, activeId, layout, visible, lastOutput, onSelect, onClose, onExit, onLayout, onNew } = props

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
          const st = status(a, lastOutput[a.id])
          return (
            <div
              key={a.id}
              className={`agent-tab ${a.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(a.id)}
              title={`${a.cwd}\n${st.label}`}
            >
              <span className={`dot ${st.cls}`} />
              <span className="agent-tab-title">{a.title}</span>
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
          const st = status(a, lastOutput[a.id])
          return (
            <div
              key={a.id}
              className={`agent-cell ${shown ? '' : 'stacked-hidden'} ${a.id === activeId ? 'focused' : ''}`}
              onMouseDown={() => onSelect(a.id)}
            >
              {layout === 'grid' && (
                <div className="agent-cell-header">
                  <span className={`dot ${st.cls}`} />
                  <span className="agent-tab-title">{a.title}</span>
                  <span className="muted small">{st.label}</span>
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
