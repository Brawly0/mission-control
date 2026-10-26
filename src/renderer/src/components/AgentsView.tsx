import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Bot, Columns3, FileText, FolderOpen, GitBranch, GitCompareArrows, LayoutGrid, Maximize2, Minimize2, Minus, Plus, Rows2, Save, Send, Shrink, Terminal, X } from 'lucide-react'
import type { ContextUsage, GitInfo, Workspace } from '@shared/types'
import type { Agent, AgentLayout } from '../types'
import { displayStatus } from '../agentStatus'
import { elapsed } from '../util'
import SessionRecap from './SessionRecap'
import { useKeyFor, useShortcutEvent, withKey } from '../shortcuts'
import ChangesPanel from './ChangesPanel'
import { Avatar, Button, EmptyState, IconButton, MenuButton, Segmented } from './ui'

// The terminal (xterm) loads with the first agent, not at startup. Output that comes first is buffered (terminalBus).
const TerminalPane = lazy(() => import('./TerminalPane'))

interface Props {
  agents: Agent[]
  activeId: string | null
  layout: AgentLayout
  /** The agent filling the whole window, if any. */
  maximized: string | null
  onMaximize: (id: string | null) => void
  visible: boolean
  lastOutput: Record<string, number>
  git: Record<string, GitInfo>
  /** Live chat sizes by session id. */
  contexts: Record<string, ContextUsage>
  /** Tokens at which a chat is marked as large (Settings). */
  warnAt: number
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onExit: (id: string, code: number) => void
  onLayout: (layout: AgentLayout) => void
  onNew: () => void
  onGitChanged: () => void
  /** Grid columns ('auto' or '1'–'4'), kept by App so workspaces can save and restore them. */
  cols: string
  onCols: (cols: string) => void
  workspaces: Workspace[]
  onOpenWorkspace: (ws: Workspace) => void
  onManageWorkspaces: () => void
  /** Opens "Send to several agents". */
  onBroadcast: () => void
}

type Cols = 'auto' | '1' | '2' | '3' | '4'
/** Track sizes (fr) per grid shape, e.g. "3x2". */
type Sizes = Record<string, { cols: number[]; rows: number[] }>

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* just won't be remembered */
  }
}

const even = (n: number) => Array.from({ length: n }, () => 1)

/** How full a chat is. Amber from your warning level, red at 2.5x it or 85% of the window. */
function ContextMeter({ usage, warnAt, onCompact, canCompact }: { usage: ContextUsage; warnAt: number; onCompact: () => void; canCompact: boolean }) {
  const level = usage.tokens >= Math.min(warnAt * 2.5, usage.window * 0.85) ? 'high' : usage.tokens >= warnAt ? 'warn' : 'ok'
  const pct = Math.min(100, (usage.tokens / usage.window) * 100)
  return (
    <span className={`ctx-meter ctx-${level}`} title={`${usage.tokens.toLocaleString()} of ${usage.window.toLocaleString()} tokens. Each reply re-reads all of it: about $${usage.perTurnUsd.toFixed(3)} per reply at API prices.`}>
      <span className="ctx-bar">
        <span style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      {Math.round(usage.tokens / 1000)}K
      {level !== 'ok' && (
        <button className="ctx-compact" disabled={!canCompact} title={canCompact ? 'Send /compact: Claude summarizes the chat so far and continues from the summary' : 'Wait until Claude finishes'} onClick={(e) => { e.stopPropagation(); onCompact() }}>
          <Minimize2 size={11} /> Compact
        </button>
      )}
    </span>
  )
}

function TabTitle({ agent, onRename, editRequest }: { agent: Agent; onRename: (title: string) => void; editRequest?: number }) {
  const [draft, setDraft] = useState<string | null>(null)
  // A rename shortcut bumps editRequest for the active tab.
  useEffect(() => {
    if (editRequest) setDraft(agent.title)
  }, [editRequest]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const { agents, activeId, layout, maximized, onMaximize, visible, lastOutput, git, contexts, warnAt, onSelect, onClose, onRename, onExit, onLayout, onNew } = props
  const [reviewOpen, setReviewOpen] = useState(false)
  const [renameRequest, setRenameRequest] = useState(0)
  const [minimized, setMinimized] = useState<Set<string>>(new Set())
  const cols = (['auto', '1', '2', '3', '4'].includes(props.cols) ? props.cols : 'auto') as Cols
  const [sizes, setSizes] = useState<Sizes>(() => load('mc.agentSizes', {}))
  const [hiddenRecaps, setHiddenRecaps] = useState<Set<string>>(new Set())
  const stageRef = useRef<HTMLDivElement>(null)
  const keyFor = useKeyFor()

  // Forget closed agents.
  useEffect(() => {
    setMinimized((cur) => {
      const next = new Set([...cur].filter((id) => agents.some((a) => a.id === id)))
      return next.size === cur.size ? cur : next
    })
  }, [agents])

  const shownAgents = agents.filter((a) => !minimized.has(a.id))
  const active = agents.find((a) => a.id === activeId) ?? agents[0]
  // In tabs, a minimized agent isn't shown; the stage shows the nearest one that isn't.
  const onStage = active && !minimized.has(active.id) ? active : shownAgents[shownAgents.length - 1]

  const restore = (id: string) => setMinimized((cur) => (cur.has(id) ? new Set([...cur].filter((x) => x !== id)) : cur))
  const select = (id: string) => {
    restore(id)
    onSelect(id)
  }
  const minimize = (id: string) => {
    if (maximized === id) onMaximize(null)
    setMinimized((cur) => new Set([...cur, id]))
    if (id === active?.id) {
      const next = shownAgents.filter((a) => a.id !== id).pop()
      if (next) onSelect(next.id)
    }
  }
  const toggleMax = (id: string) => {
    restore(id)
    onSelect(id)
    onMaximize(maximized === id ? null : id)
  }

  useShortcutEvent(
    ['toggleReview', 'renameAgent', 'maximizeAgent', 'minimizeAgent'],
    (id) => {
      if (id === 'toggleReview') setReviewOpen((o) => !o)
      else if (id === 'renameAgent') setRenameRequest(Date.now())
      else if (id === 'maximizeAgent' && active) toggleMax(active.id)
      else if (id === 'minimizeAgent' && active) {
        if (maximized) onMaximize(null)
        else minimize(active.id)
      }
    },
    visible
  )

  if (agents.length === 0) {
    return (
      <EmptyState icon={Bot} title="No agents running">
        <p>Start Claude in a project and it runs here, live. Run several side by side in a grid, or open a project’s chats all at once from its Chats tab.</p>
        <Button variant="primary" icon={Plus} onClick={onNew}>
          New session in current project
        </Button>
        {props.workspaces.length > 0 && (
          <div className="empty-workspaces">
            <span className="muted small">Or open a workspace</span>
            {props.workspaces.slice(0, 6).map((w) => (
              <Button key={w.id} size="sm" icon={FolderOpen} onClick={() => props.onOpenWorkspace(w)} title={w.agents.map((a) => a.title).join('\n')}>
                {w.name} · {w.agents.length}
              </Button>
            ))}
          </div>
        )}
      </EmptyState>
    )
  }

  const reviewable = (a: Agent) => Boolean(a.worktree || git[a.projectPath]?.isRepo)
  const showReview = reviewOpen && !!active && reviewable(active) && !maximized

  // Grid shape and track sizes.
  const grid = layout === 'grid' && !maximized
  const n = Math.max(1, shownAgents.length)
  const c = Math.min(n, cols === 'auto' ? Math.ceil(Math.sqrt(n)) : Number(cols))
  const r = Math.ceil(n / c)
  const shape = `${c}x${r}`
  const track = sizes[shape] && sizes[shape].cols.length === c && sizes[shape].rows.length === r ? sizes[shape] : { cols: even(c), rows: even(r) }
  const customSized = !!sizes[shape]
  const template = (fr: number[]) => fr.map((f) => `minmax(0, ${f}fr)`).join(' 6px ')

  /** Dragging a gutter moves the line between two columns (or rows); double-click evens them out. */
  const startDrag = (axis: 'cols' | 'rows', k: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current
    if (!stage) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const rect = stage.getBoundingClientRect()
    const count = axis === 'cols' ? c : r
    const avail = (axis === 'cols' ? rect.width : rect.height) - 16 - 6 * (count - 1)
    const start = axis === 'cols' ? e.clientX : e.clientY
    const base = [...track[axis]]
    const sum = base.reduce((a, b) => a + b, 0)
    const min = (sum / count) * 0.2
    let latest = track
    const move = (ev: PointerEvent) => {
      const delta = (((axis === 'cols' ? ev.clientX : ev.clientY) - start) / Math.max(1, avail)) * sum
      const pair = base[k] + base[k + 1]
      const a = Math.min(pair - min, Math.max(min, base[k] + delta))
      const next = [...base]
      next[k] = a
      next[k + 1] = pair - a
      latest = { ...track, [axis]: next }
      setSizes((cur) => ({ ...cur, [shape]: latest }))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setSizes((cur) => {
        const all = { ...cur, [shape]: latest }
        save('mc.agentSizes', all)
        return all
      })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const evenOut = () =>
    setSizes((cur) => {
      const { [shape]: _gone, ...rest } = cur
      save('mc.agentSizes', rest)
      return rest
    })

  const stageStyle = grid ? { gridTemplateColumns: template(track.cols), gridTemplateRows: template(track.rows) } : undefined
  const focusId = maximized ?? onStage?.id

  return (
    <div className="agents">
      <div className="agent-bar">
        <div className="agent-tabs">
          {agents.map((a, i) => {
            const st = displayStatus(a, lastOutput[a.id])
            const jump = i < 9 ? keyFor(`agent${i + 1}`) : ''
            const isMin = minimized.has(a.id)
            return (
              <div
                key={a.id}
                className={`agent-tab ${a.id === active?.id && !isMin ? 'active' : ''} ${st.cls === 'needs-input' ? 'attention' : ''} ${isMin ? 'minimized' : ''}`}
                onClick={() => select(a.id)}
                title={`${a.cwd}\n${st.label}${isMin ? '\nMinimized: click to bring it back' : ''}${jump ? `\n${jump} switches here` : ''}`}
              >
                <span className={`dot ${st.cls}`} />
                {a.kind === 'shell' && <Terminal size={12} className="muted" />}
                {a.worktree && <GitBranch size={12} className="tone-accent" />}
                <TabTitle agent={a} onRename={(t) => onRename(a.id, t)} editRequest={a.id === active?.id ? renameRequest : undefined} />
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
          {layout === 'grid' && (
            <>
              {customSized && <IconButton icon={Columns3} label="Even out the sizes (or double-click a divider)" size={14} onClick={evenOut} />}
              <span className="agent-cols" title="Columns in the grid">
                <Segmented<Cols>
                  value={cols}
                  onChange={(v) => props.onCols(v)}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '3', label: '3' },
                    { value: '4', label: '4' }
                  ]}
                />
              </span>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={Send}
            disabled={!agents.some((a) => a.kind === 'claude' && !a.exited)}
            title={withKey('Send one prompt to several agents', keyFor('broadcast'))}
            onClick={props.onBroadcast}
          >
            Send to…
          </Button>
          <MenuButton
            align="right"
            trigger={(toggle) => (
              <Button size="sm" variant="ghost" icon={LayoutGrid} onClick={toggle} title="Save these agents as a workspace, or open a saved one">
                Workspaces
              </Button>
            )}
            items={[
              ...props.workspaces.slice(0, 8).map((w) => ({
                label: w.name,
                hint: `${w.agents.length} ${w.agents.length === 1 ? 'agent' : 'agents'} · ${w.layout}`,
                icon: FolderOpen,
                onSelect: () => props.onOpenWorkspace(w)
              })),
              { label: 'Save or manage workspaces…', icon: Save, onSelect: props.onManageWorkspaces }
            ]}
          />
          <Button
            size="sm"
            variant={showReview ? 'secondary' : 'ghost'}
            icon={GitCompareArrows}
            disabled={!active || !reviewable(active)}
            title={active && reviewable(active) ? withKey('Review this agent’s changes', keyFor('toggleReview')) : 'Not a git repository'}
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
        <div className="agent-stage-wrap">
          <div ref={stageRef} className={`agent-stage ${grid ? 'grid' : 'tabs'}`} style={stageStyle}>
            {agents.map((a) => {
              const isMin = minimized.has(a.id)
              const shown = maximized ? a.id === maximized : grid ? !isMin : a.id === onStage?.id
              const pos = shownAgents.indexOf(a)
              const row = Math.floor(pos / c)
              const col = pos % c
              // The last cell stretches over the empty columns of its row.
              const place =
                grid && pos >= 0
                  ? { gridRow: `${2 * row + 1}`, gridColumn: pos === shownAgents.length - 1 && col < c - 1 ? `${2 * col + 1} / ${2 * c}` : `${2 * col + 1}` }
                  : undefined
              const st = displayStatus(a, lastOutput[a.id])
              const isMax = maximized === a.id
              return (
                <div
                  key={a.id}
                  className={`agent-cell ${shown ? '' : 'stacked-hidden'} ${a.id === focusId ? 'focused' : ''} status-${st.cls}`}
                  style={place}
                  onMouseDown={() => onSelect(a.id)}
                >
                  <div className="agent-cell-head" onDoubleClick={(e) => (e.target as HTMLElement).closest('button') || toggleMax(a.id)} title="Double-click to maximize or restore">
                    <Avatar name={a.projectName} path={a.projectPath} size={20} />
                    <span className="strong ellipsis">{grid || isMax ? a.title : a.projectName}</span>
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
                    {a.sessionId && contexts[a.sessionId] && (
                      <ContextMeter
                        usage={contexts[a.sessionId]}
                        warnAt={warnAt}
                        canCompact={!a.exited && st.cls !== 'working'}
                        onCompact={() => window.mc.ptyWrite(a.id, '/compact\r')}
                      />
                    )}
                    {a.kind === 'claude' && !a.exited && (
                      <button
                        className="agent-brief"
                        disabled={st.cls === 'working'}
                        title={st.cls === 'working' ? 'Wait until Claude finishes' : withKey('Ask Claude to write a session briefing for the next session', keyFor('writeBriefing'))}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(a.id)
                          window.dispatchEvent(new CustomEvent('mc:run-shortcut', { detail: 'writeBriefing' }))
                        }}
                      >
                        <FileText size={11} /> Briefing
                      </button>
                    )}
                    <span className="muted small agent-elapsed">{elapsed(a.startedAt)}</span>
                    <span className="cell-controls">
                      <button title={withKey('Minimize', keyFor('minimizeAgent'))} onClick={(e) => { e.stopPropagation(); minimize(a.id) }}>
                        <Minus size={13} />
                      </button>
                      <button title={withKey(isMax ? 'Restore' : 'Maximize (fills the window)', keyFor('maximizeAgent'))} onClick={(e) => { e.stopPropagation(); toggleMax(a.id) }}>
                        {isMax ? <Shrink size={12} /> : <Maximize2 size={12} />}
                      </button>
                      <button className="cell-close" title="Close (stops the process)" onClick={(e) => { e.stopPropagation(); onClose(a.id) }}>
                        <X size={13} />
                      </button>
                    </span>
                  </div>
                  {a.resumedFrom && !hiddenRecaps.has(a.id) && (
                    <SessionRecap compact sessionId={a.resumedFrom} onClose={() => setHiddenRecaps((cur) => new Set([...cur, a.id]))} />
                  )}
                  <Suspense fallback={null}>
                    <TerminalPane id={a.id} visible={visible && shown && a.id === focusId} onExit={(code) => onExit(a.id, code)} />
                  </Suspense>
                </div>
              )
            })}
            {grid &&
              track.cols.slice(1).map((_, k) => (
                <div key={`c${k}`} className="grid-gutter col" style={{ gridColumn: `${2 * k + 2}`, gridRow: '1 / -1' }} onPointerDown={startDrag('cols', k)} onDoubleClick={evenOut} title="Drag to resize · double-click to even out" />
              ))}
            {grid &&
              track.rows.slice(1).map((_, k) => (
                <div key={`r${k}`} className="grid-gutter row" style={{ gridRow: `${2 * k + 2}`, gridColumn: '1 / -1' }} onPointerDown={startDrag('rows', k)} onDoubleClick={evenOut} title="Drag to resize · double-click to even out" />
              ))}
            {shownAgents.length === 0 && !maximized && (
              <div className="stage-empty muted">All agents are minimized. Click one below to bring it back.</div>
            )}
          </div>
          {minimized.size > 0 && !maximized && (
            <div className="agent-dock">
              <span className="muted small">Minimized</span>
              {agents
                .filter((a) => minimized.has(a.id))
                .map((a) => {
                  const st = displayStatus(a, lastOutput[a.id])
                  return (
                    <button key={a.id} className={`dock-item ${st.cls === 'needs-input' ? 'attention' : ''}`} onClick={() => select(a.id)} title={`${a.title}\n${st.label}\nClick to bring it back`}>
                      <span className={`dot ${st.cls}`} />
                      <span className="ellipsis">{a.title}</span>
                    </button>
                  )
                })}
              <Button size="sm" variant="ghost" onClick={() => setMinimized(new Set())}>
                Restore all
              </Button>
            </div>
          )}
        </div>
        {showReview && active && (
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
