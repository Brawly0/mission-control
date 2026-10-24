import { useEffect, useState } from 'react'
import { FileText, PiggyBank, Plug, RotateCcw } from 'lucide-react'
import type { Project, ProjectMeta, StartupReport } from '@shared/types'
import { formatCost, formatTokens } from '../util'
import { Button } from './ui'

const SCOPE_LABEL = { user: 'all projects', local: 'this project', project: '.mcp.json' } as const

/**
 * Per-project levers on cost: the default model for new chats and tasks, what a new chat carries
 * before you type (measured from recent chats), and which MCP servers agents load here.
 */
export default function SpendingCard({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [report, setReport] = useState<StartupReport | null>(null)
  const [model, setModel] = useState(project.meta.defaultModel ?? '')

  const load = () => window.mc.startupReport(project.path, project.keys).then(setReport).catch(() => setReport(null))
  useEffect(() => {
    setModel(project.meta.defaultModel ?? '')
    void load()
  }, [project.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<ProjectMeta>) => {
    await window.mc.setProjectMeta(project.path, patch)
    onChanged()
    void load()
  }

  const toggleServer = (name: string, on: boolean) => {
    if (!report) return
    const enabled = report.servers.filter((s) => (s.name === name ? on : s.enabled)).map((s) => s.name)
    // All on again means "no limit", so new servers you add later load here too.
    void save({ mcpAllow: enabled.length === report.servers.length ? (null as never) : enabled })
  }

  const fileTokens = report?.files.reduce((t, f) => t + f.tokens, 0) ?? 0

  return (
    <section className="card overview-card spending-card">
      <h3>
        <PiggyBank size={15} /> Spending
      </h3>

      <label className="field">
        <span className="field-label">Model for new chats and tasks</span>
        <select
          className="select"
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            void save({ defaultModel: e.target.value })
          }}
        >
          <option value="">Claude’s default</option>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>
        <span className="field-hint">Used by New session and by tasks that don’t pick a model. Resumed chats keep their own.</span>
      </label>

      <div className="field">
        <span className="field-label">What every new chat starts with</span>
        {report?.measured ? (
          <div className="startup-hero">
            <span className="hero-value">{formatTokens(report.measured.medianTokens)}</span>
            <span className="small muted">
              tokens before your first message (typical of the last {report.measured.samples} chats), about {formatCost(report.measured.firstTurnUsd)} to start each chat at API prices.
            </span>
          </div>
        ) : (
          <span className="small muted">Measured after this project has a chat in the index.</span>
        )}
        <span className="field-hint">That’s Claude Code’s instructions, tool lists (including every MCP server’s tools), and the files below.</span>
      </div>

      {report && report.files.length > 0 && (
        <div className="field">
          <span className="field-label">
            <FileText size={12} /> Instruction and memory files · about {formatTokens(fileTokens)} tokens
          </span>
          <ul className="startup-files">
            {report.files.map((f) => (
              <li key={f.path} title={f.path}>
                <span className="ellipsis">{f.label}</span>
                <span className={`mono small ${f.tokens > 3000 ? 'warn-text' : 'muted'}`}>{formatTokens(f.tokens)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report && (
        <div className="field">
          <span className="field-label">
            <Plug size={12} /> MCP servers for agents started here
          </span>
          {report.servers.length === 0 ? (
            <span className="small muted">None configured.</span>
          ) : (
            <ul className="mcp-list">
              {report.servers.map((s) => (
                <li key={s.name}>
                  <label title={s.detail}>
                    <input type="checkbox" checked={s.enabled} onChange={(e) => toggleServer(s.name, e.target.checked)} />
                    <span className="strong">{s.name}</span>
                    <span className="muted small">
                      {s.kind} · {SCOPE_LABEL[s.scope]}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <span className="field-hint">
            {report.restricted
              ? 'Only the checked servers load in chats and tasks Mission Control starts here. That also leaves out plugin servers and claude.ai connectors. Chats you start elsewhere are unchanged.'
              : 'Every server’s tool list is sent with every chat. Uncheck the ones this project never uses to make each chat start smaller.'}
          </span>
          {report.restricted && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => save({ mcpAllow: null as never })}>
              Load all servers again
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
