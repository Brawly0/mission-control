import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Coins, Info, MessagesSquare, RefreshCw, Sigma, Table2, Zap } from 'lucide-react'
import type { IndexStatus, RateLimitInfo, UsageReport, UsageTotals } from '@shared/types'
import { resetsIn, windowLabel } from '@shared/planUsage'
import { basename, errorMessage, formatCost, formatTokens, timeAgo } from '../util'
import { Avatar, EmptyState, IconButton, Segmented } from './ui'
import { useLook } from '../projectLook'

interface Props {
  visible: boolean
  status: IndexStatus | null
  rateLimit: RateLimitInfo | null
  onOpenProject: (path: string) => void
  onOpenSession: (projectPath: string, sessionId: string) => void
}

type Range = '7' | '30' | '90' | 'all'
const DAY = 86_400_000

const allTokens = (t: UsageTotals) => t.input + t.output + t.cacheWrite + t.cacheRead

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Rounds a max value up to a clean axis top (1, 2, 2.5, 5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}

/** A column with a 4px rounded data end and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, base: number): string {
  const h = base - y
  if (h <= 0) return ''
  const r = Math.min(4, h, w / 2)
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`
}

function DailyChart({ days }: { days: (UsageTotals & { day: string })[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const H = 220
  const pad = { top: 18, right: 8, bottom: 26, left: 52 }
  const plotW = Math.max(100, width - pad.left - pad.right)
  const plotH = H - pad.top - pad.bottom
  const max = niceMax(Math.max(...days.map((d) => d.cost), 0))
  const slot = plotW / Math.max(days.length, 1)
  const barW = Math.max(2, Math.min(24, slot - 2))
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const peak = days.reduce((best, d, i) => (d.cost > (days[best]?.cost ?? -1) ? i : best), 0)
  const labelEvery = Math.ceil(days.length / Math.max(1, Math.floor(plotW / 64)))
  const y = (v: number) => pad.top + plotH - (v / max) * plotH

  const fmtDay = (key: string, long = false) => {
    const [yy, mm, dd] = key.split('-').map(Number)
    return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })
  }

  const hovered = hover !== null ? days[hover] : null
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img" aria-label="Estimated cost per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.left - 8} y={y(t) + 4} className="axis" textAnchor="end">
              {formatCost(t).replace('.00', '')}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2
          return (
            <g key={d.day}>
              {hover === i && <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} className="hover-band" />}
              <path d={columnPath(x, y(d.cost), barW, pad.top + plotH)} className="bar" />
              {/* Hit target: the whole column slot, not just the bar. */}
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              {i % labelEvery === 0 && (
                <text x={pad.left + i * slot + slot / 2} y={H - 8} className="axis" textAnchor="middle">
                  {fmtDay(d.day)}
                </text>
              )}
            </g>
          )
        })}
        {days[peak]?.cost > 0 && (
          <text x={pad.left + peak * slot + slot / 2} y={y(days[peak].cost) - 6} className="value-label" textAnchor="middle">
            {formatCost(days[peak].cost)}
          </text>
        )}
      </svg>
      {hovered && (
        <div
          className="tooltip"
          style={{
            left: Math.min(pad.left + (hover! + 0.5) * slot, width - 170),
            top: Math.max(0, y(hovered.cost) - 70)
          }}
        >
          <div className="strong">{fmtDay(hovered.day, true)}</div>
          <div className="tooltip-row">
            <span>Estimated cost</span>
            <span>{formatCost(hovered.cost)}</span>
          </div>
          <div className="tooltip-row">
            <span>Tokens</span>
            <span>{formatTokens(allTokens(hovered))}</span>
          </div>
          <div className="tooltip-row">
            <span>Output</span>
            <span>{formatTokens(hovered.output)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

const TEMP = '(temp)'
const TEMP_PATH = /[\\/](AppData[\\/]Local[\\/]Temp|scratch-workspaces)[\\/]/i

function BarRow({ label, avatar, total, max, onClick, sub }: { label: string; avatar?: string; total: UsageTotals; max: number; onClick?: () => void; sub?: string }) {
  const pct = max > 0 ? Math.max(1.5, (total.cost / max) * 100) : 0
  return (
    <button className="bar-row" onClick={onClick} disabled={!onClick}>
      <span className="bar-row-label">
        {avatar !== undefined && <Avatar name={label} path={avatar} size={22} />}
        <span className="ellipsis">{label}</span>
        {sub && <span className="muted small bar-row-sub">{sub}</span>}
      </span>
      <span className="bar-row-track" aria-hidden>
        <span className="bar-row-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="bar-row-value">{formatCost(total.cost)}</span>
      <span className="bar-row-tokens muted">{formatTokens(allTokens(total))}</span>
    </button>
  )
}

/** Plan limits from your Claude account: one meter per window, what's left and when it resets. */
function PlanLimits({ info }: { info: RateLimitInfo }) {
  const [refreshing, setRefreshing] = useState(false)
  const refresh = (): void => {
    setRefreshing(true)
    window.mc.refreshRateLimit().finally(() => setRefreshing(false))
  }
  const x = info.extraUsage
  return (
    <section className="card usage-card">
      <div className="usage-card-head">
        <h2>Plan limits{info.plan ? ` · ${info.plan[0].toUpperCase()}${info.plan.slice(1)}` : ''}</h2>
        <span className="muted small">
          updated {timeAgo(info.at)}
          <IconButton icon={RefreshCw} label="Check now" size={13} onClick={refresh} disabled={refreshing} />
        </span>
      </div>
      {info.error && <p className="plan-error small">{info.error}</p>}
      {info.windows.map((w) => {
        const pct = Math.round(w.utilization * 100)
        return (
          <div key={w.name} className="meter-row">
            <span className="meter-label">{windowLabel(w.name, true)}</span>
            <span className="meter-track" aria-hidden>
              <span className={`meter-fill ${pct >= 90 ? 'high' : pct >= 70 ? 'warn' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className="meter-value">
              {pct}% used · <span className="muted">{Math.max(0, 100 - pct)}% left</span>
            </span>
            <span className="muted small">
              {w.resetsAt
                ? w.resetsAt - Date.now() > 86_400_000
                  ? `resets ${resetsIn(w.resetsAt, Date.now())}`
                  : `resets in ${resetsIn(w.resetsAt, Date.now())} (${new Date(w.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`
                : ''}
            </span>
          </div>
        )
      })}
      {x && (
        <p className="muted small plan-extra">
          Extra usage {x.enabled ? `on: $${x.usedUsd.toFixed(2)} of $${x.limitUsd.toFixed(2)} used this month` : 'off: when a limit runs out, Claude waits for the reset'}.
        </p>
      )}
    </section>
  )
}

export default function UsageView({ visible, status, rateLimit, onOpenProject, onOpenSession }: Props) {
  const look = useLook()
  const [range, setRange] = useState<Range>('30')
  const [report, setReport] = useState<UsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asTable, setAsTable] = useState(false)

  const since = useMemo(() => {
    if (range === 'all') return 0
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime() - (Number(range) - 1) * DAY
  }, [range])

  useEffect(() => {
    if (!visible) return
    window.mc
      .usageReport(since)
      .then((r) => {
        setReport(r)
        setError(null)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [visible, since, status?.lastRun])

  // Every day in the range, including days with no usage, so gaps show as gaps.
  const days = useMemo(() => {
    if (!report) return []
    const byKey = new Map(report.byDay.map((d) => [d.day, d]))
    const first = range === 'all' ? (report.byDay[0] ? new Date(report.byDay[0].day + 'T00:00') : new Date()) : new Date(since)
    const out: (UsageTotals & { day: string })[] = []
    for (let d = new Date(first); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const key = dayKey(d)
      out.push(byKey.get(key) ?? { day: key, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 })
    }
    return out
  }, [report, range, since])

  const t = report?.totals
  // Test runs, temp and Claude Desktop scratch folders share one row instead of one each.
  const projectRows = useMemo(() => {
    const rows: UsageReport['byProject'] = []
    let temp: UsageReport['byProject'][number] | null = null
    for (const r of report?.byProject ?? []) {
      if (!TEMP_PATH.test(r.projectPath)) {
        rows.push(r)
        continue
      }
      if (!temp) temp = { ...r, projectKey: '', projectPath: TEMP }
      else {
        const t = temp as unknown as Record<string, number>
        for (const [k, v] of Object.entries(r)) if (typeof v === 'number') t[k] = (t[k] ?? 0) + v
      }
    }
    return temp ? [...rows, temp] : rows
  }, [report])
  const maxProject = Math.max(0, ...projectRows.map((p) => p.cost))
  const maxModel = Math.max(0, ...(report?.byModel.map((m) => m.cost) ?? []))
  const maxSession = Math.max(0, ...(report?.topSessions.map((s) => s.cost) ?? []))

  return (
    <div className="usage scroll">
      <header className="usage-head">
        <div>
          <h1>Usage</h1>
          <p className="muted">
            <Info size={13} /> Costs are estimates at Anthropic API list prices. On a Pro or Max plan you don't pay these amounts.
          </p>
        </div>
        <Segmented<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: 'all', label: 'All time' }
          ]}
        />
      </header>

      {rateLimit && rateLimit.windows.length > 0 && <PlanLimits info={rateLimit} />}
      {error && <div className="error pad">{error}</div>}
      {!report && !error && <div className="muted pad">{status?.indexing ? `Reading your chats… ${status.done}/${status.total}` : 'Loading…'}</div>}
      {report && t && allTokens(t) === 0 && (
        <EmptyState icon={BarChart3} title="No usage in this period">
          Pick a longer range, or start a session.
        </EmptyState>
      )}

      {report && t && allTokens(t) > 0 && (
        <>
          <section className="stat-row">
            <div className="stat">
              <Coins size={18} className="stat-icon tone-accent" />
              <div className="stat-value">{formatCost(t.cost)}</div>
              <div className="stat-label">Estimated cost</div>
            </div>
            <div className="stat">
              <Sigma size={18} className="stat-icon" />
              <div className="stat-value">{formatTokens(allTokens(t))}</div>
              <div className="stat-label">Tokens (incl. cache)</div>
            </div>
            <div className="stat">
              <Zap size={18} className="stat-icon" />
              <div className="stat-value">{formatTokens(t.output)}</div>
              <div className="stat-label">Output tokens</div>
            </div>
            <div className="stat">
              <MessagesSquare size={18} className="stat-icon" />
              <div className="stat-value">{t.sessions ?? 0}</div>
              <div className="stat-label">Chats with activity</div>
            </div>
          </section>

          <section className="card usage-card">
            <div className="usage-card-head">
              <h2>Estimated cost per day</h2>
              <IconButton icon={asTable ? BarChart3 : Table2} label={asTable ? 'Show chart' : 'Show as table'} size={15} onClick={() => setAsTable((v) => !v)} />
            </div>
            {asTable ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Cost</th>
                    <th>Tokens</th>
                    <th>Output</th>
                  </tr>
                </thead>
                <tbody>
                  {[...days].reverse().filter((d) => d.cost > 0).map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td>{formatCost(d.cost)}</td>
                      <td>{formatTokens(allTokens(d))}</td>
                      <td>{formatTokens(d.output)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <DailyChart days={days} />
            )}
          </section>

          <div className="usage-columns">
            <section className="card usage-card">
              <div className="usage-card-head">
                <h2>By project</h2>
                <span className="muted small">cost · tokens</span>
              </div>
              {projectRows.map((p) => (
                <BarRow
                  key={p.projectKey || p.projectPath}
                  label={p.projectPath === TEMP ? 'Temp and scratch folders' : (look(p.projectPath)?.name ?? (basename(p.projectPath) || p.projectKey))}
                  avatar={p.projectPath || p.projectKey}
                  total={p}
                  max={maxProject}
                  sub={`${p.sessions ?? 0} chats`}
                  onClick={p.projectPath === TEMP ? undefined : () => onOpenProject(p.projectPath)}
                />
              ))}
            </section>
            <section className="card usage-card">
              <div className="usage-card-head">
                <h2>By model</h2>
                <span className="muted small">cost · tokens</span>
              </div>
              {report.byModel.map((m) => (
                <BarRow key={m.model} label={m.model} total={m} max={maxModel} />
              ))}
            </section>
          </div>

          <section className="card usage-card">
            <div className="usage-card-head">
              <h2>Most expensive chats</h2>
              <span className="muted small">cost · tokens</span>
            </div>
            {report.topSessions.map((s) => (
              <BarRow
                key={s.sessionId}
                label={s.title}
                avatar={s.projectPath}
                sub={`${look(s.projectPath)?.name ?? basename(s.projectPath)} · ${timeAgo(s.updated)}`}
                total={s}
                max={maxSession}
                onClick={() => onOpenSession(s.projectPath, s.sessionId)}
              />
            ))}
          </section>
        </>
      )}
    </div>
  )
}
