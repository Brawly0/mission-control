import { Clock3, CodeXml, Sparkles, Sun } from 'lucide-react'
import type { VibeStats } from '@shared/types'
import { timeLabel } from '../homeMetrics'

const exact = (n: number) => Math.round(n).toLocaleString()
const compact = (n: number) => n.toLocaleString([], { notation: 'compact', maximumFractionDigits: 2 })
const usd = (n: number) => n.toLocaleString([], { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 100 ? 0 : 2 })
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '0%')
const dayLabel = (key: string) => new Date(key + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })

/** "claude-opus-5-5" → "Opus 5.5"; anything else is shown as is. */
function modelName(model: string): string {
  const m = /claude-(\w+)-(\d+)(?:-(\d))?(?:-\d{8})?$/.exec(model)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : model
}

export const VIBE_HINT =
  'Time: within one chat, the time between two messages up to 15 minutes apart counts; longer gaps are breaks. Every Claude API call counts as a message, so time an agent spends working on its own is included. Chats running at the same time count once, so this is real clock time. Tokens are read exactly from Claude Code and Codex session files on this computer.'

interface Fact {
  id: string
  text: string
  hint?: string
}

function facts(s: VibeStats): Fact[] {
  const { claude: c, codex: x, time: t } = s
  const out: Fact[] = []
  if (c.total && x.total) {
    const big = c.total >= x.total ? ['Claude', c.total, 'Codex', x.total] as const : ['Codex', x.total, 'Claude', c.total] as const
    out.push({ id: 'ratio', text: `${big[0]} has processed ${(big[1] / big[3]).toFixed(1)}× more tokens than ${big[2]}.`, hint: `${exact(big[1])} vs ${exact(big[3])} tokens` })
  }
  if (c.cacheRead) out.push({ id: 'cache', text: `Prompt caching saved about ${usd(c.cacheSavingsUsd)}: ${pct(c.cacheRead, c.total)} of Claude's tokens were cheap cache re-reads.`, hint: `${exact(c.cacheRead)} cache-read tokens, priced at the cache rate instead of the full input rate (API list prices)` })
  if (c.output) out.push({ id: 'output', text: `Claude itself wrote ${compact(c.output)} tokens. That's only ${pct(c.output, c.total)} of the total; the rest was it reading your code and the chat.`, hint: `${exact(c.output)} output tokens` })
  if (c.topDay) out.push({ id: 'day', text: `Priciest day: ${dayLabel(c.topDay.day)}, ${usd(c.topDay.costUsd)} of Claude usage.`, hint: `${exact(c.topDay.total)} tokens that day` })
  if (c.topChat) out.push({ id: 'chat', text: `Priciest chat: “${c.topChat.title}”, ${usd(c.topChat.costUsd)}.`, hint: `${exact(c.topChat.total)} tokens · ${c.topChat.projectPath}` })
  const fav = c.byModel[0]
  if (fav && c.costUsd) out.push({ id: 'model', text: `Favourite model: ${modelName(fav.model)}, ${pct(fav.costUsd, c.costUsd)} of Claude's estimated cost.`, hint: c.byModel.map(m => `${modelName(m.model)}: ${usd(m.costUsd)}`).join('\n') })
  if (c.costUsd && t.claudeMinutes >= 1) out.push({ id: 'hourly', text: `Claude time is worth ${usd(c.costUsd / (t.claudeMinutes / 60))} an hour at API prices.`, hint: `${usd(c.costUsd)} over ${timeLabel(t.claudeMinutes)} of Claude time` })
  if (x.input) out.push({ id: 'codex-cache', text: `Codex reused cached context for ${pct(x.cachedInput, x.input)} of its input.`, hint: `${exact(x.cachedInput)} of ${exact(x.input)} input tokens` })
  if (t.busiestHour) out.push({ id: 'hour', text: `You vibe hardest around ${hourLabel(t.busiestHour.hour)}: ${timeLabel(t.busiestHour.minutes)} spent in that hour of the day.` })
  if (t.longestDay) out.push({ id: 'longest', text: `Longest day: ${dayLabel(t.longestDay.day)}, ${timeLabel(t.longestDay.minutes)} of vibe coding.` })
  if (t.longestStreak) out.push({ id: 'streak', text: `Longest streak: ${t.longestStreak.days} ${t.longestStreak.days === 1 ? 'day' : 'days'} in a row${t.currentStreak ? `. Current streak: ${t.currentStreak}` : ''}.`, hint: `${dayLabel(t.longestStreak.from)} – ${dayLabel(t.longestStreak.to)}` })
  if (t.parallelMinutes >= 1) out.push({ id: 'parallel', text: `Running chats side by side gave you ${timeLabel(t.parallelMinutes)} of extra agent time.`, hint: 'Each chat’s own time added up, minus the real clock time' })
  if (t.firstAt) out.push({ id: 'since', text: `First chat: ${new Date(t.firstAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}. ${t.activeDays} active ${t.activeDays === 1 ? 'day' : 'days'} since.` })
  return out
}

export default function VibeStatsPanel({ stats, error, onRetry }: { stats: VibeStats | null; error: boolean; onRetry: () => void }) {
  const loading = !stats && !error
  const c = stats?.claude, x = stats?.codex, t = stats?.time
  return <section className="hd-panel hd-vibe" aria-label="Vibe coding stats" aria-busy={loading}>
    <div className="hd-panel-head"><h2>Vibe Coding Stats</h2><span className="hd-vibe-sub" title={VIBE_HINT}>All time · exact token counts</span></div>
    {error && !stats && <p className="hd-data-error">Stats couldn’t be read. <button onClick={onRetry}>Retry</button></p>}
    <div className="hd-vibe-tiles">
      <div className="hd-vibe-tile hd-tone-claude" title={c ? `Input ${exact(c.input)}\nOutput ${exact(c.output)}\nCache writes ${exact(c.cacheWrite)}\nCache reads ${exact(c.cacheRead)}\nTotal ${exact(c.total)}` : undefined}>
        <span className="hd-provider-icon"><Sun size={20} /></span>
        <span className="hd-vibe-copy"><small>Claude tokens</small><strong>{c ? compact(c.total) : '—'}</strong>
          <span>{c ? `${exact(c.total)} · ${usd(c.costUsd)} at API prices` : loading ? 'Loading…' : 'Unavailable'}</span>
          {c && <span>{c.replies.toLocaleString()} replies · {c.sessions.toLocaleString()} chats</span>}</span>
      </div>
      <div className="hd-vibe-tile hd-tone-codex" title={x ? `Input ${exact(x.input)} (cached ${exact(x.cachedInput)})\nOutput ${exact(x.output)} (reasoning ${exact(x.reasoning)})\nTotal ${exact(x.total)}` : undefined}>
        <span className="hd-provider-icon"><CodeXml size={20} /></span>
        <span className="hd-vibe-copy"><small>Codex tokens</small><strong>{x ? compact(x.total) : '—'}</strong>
          <span>{x ? exact(x.total) : loading ? 'Loading…' : 'Unavailable'}</span>
          {x && <span>{x.sessions.toLocaleString()} chats{x.byModel[0] ? ` · mostly ${x.byModel[0].model}` : ''}</span>}</span>
      </div>
      <div className="hd-vibe-tile hd-tone-violet" title={VIBE_HINT}>
        <span className="hd-provider-icon"><Clock3 size={20} /></span>
        <span className="hd-vibe-copy"><small>Time vibe coding</small><strong>{t ? timeLabel(t.minutes) : '—'}</strong>
          <span>{t ? `This week ${timeLabel(t.weekMinutes)} · today ${timeLabel(t.todayMinutes)}` : loading ? 'Loading…' : 'Unavailable'}</span>
          {t && <span>Claude {timeLabel(t.claudeMinutes)} · Codex {timeLabel(t.codexMinutes)}</span>}</span>
      </div>
    </div>
    {stats && <>
      <h3 className="hd-vibe-facts-head"><Sparkles size={13} /> Fun facts</h3>
      <ul className="hd-vibe-facts">{facts(stats).map(f => <li key={f.id} title={f.hint}>{f.text}</li>)}</ul>
      <p className="hd-usage-note">Dollar amounts are what this usage would cost at Anthropic’s API list prices, not what your plan charges. Codex has no dollar estimate.</p>
    </>}
  </section>
}
