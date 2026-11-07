import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, FileCode2, FilePlus2, GitCommitHorizontal, History, Loader2, Sparkles, X } from 'lucide-react'
import type { SessionRecap as Recap } from '@shared/types'
import { activeTime } from '@shared/recap'
import { errorMessage, timeAgo } from '../util'
import { useToast } from '../toast'
import { Button, IconButton } from './ui'

interface Props {
  sessionId: string
  /** Changes when the chat changed on disk, so the recap is read again. */
  version?: number
  /** Banner above a resumed agent's terminal: one line until expanded. */
  compact?: boolean
  onClose?: () => void
  /** Claude gave the chat a new title. */
  onTitle?: (title: string) => void
  /** Whose chat it is, for "Codex's last reply". */
  tool?: 'claude' | 'codex'
}

function loadOpen(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function span(r: Recap): string {
  if (!r.startedAt) return ''
  const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const same = day(r.startedAt) === day(r.endedAt)
  return `${day(r.startedAt)}, ${time(r.startedAt)} – ${same ? '' : `${day(r.endedAt)}, `}${time(r.endedAt)}`
}

/** "What we worked on": Claude's summary when there is one, otherwise what the transcript shows. */
export default function SessionRecap({ sessionId, version, compact, onClose, onTitle, tool }: Props) {
  const toast = useToast()
  const [recap, setRecap] = useState<Recap | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const openKey = compact ? 'mc.recapBanner' : 'mc.recapOpen'
  const [open, setOpen] = useState(() => loadOpen(openKey, !compact))

  useEffect(() => {
    let cancelled = false
    setError('')
    window.mc
      .sessionRecap(sessionId)
      .then((r) => !cancelled && setRecap(r))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [sessionId, version])

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(openKey, o ? '0' : '1')
      } catch {
        /* just won't be remembered */
      }
      return !o
    })
  }

  const summarize = async () => {
    setBusy(true)
    try {
      const ai = await window.mc.summarizeChat(sessionId)
      setRecap((r) => (r ? { ...r, ai } : r))
      setOpen(true)
      onTitle?.(ai.title)
    } catch (e) {
      toast('error', 'Could not summarize the chat', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (error) return compact ? null : <div className="recap recap-error muted small">{error}</div>
  if (!recap) return <div className={`recap ${compact ? 'recap-compact' : ''} muted small`}>Reading what happened in this chat…</div>
  if (!recap.prompts) return null

  const r = recap
  const latest = r.lastPrompts[r.lastPrompts.length - 1] ?? r.firstPrompts[r.firstPrompts.length - 1]
  const facts = [
    r.activeMinutes ? `active ${activeTime(r.activeMinutes)}` : '',
    `${r.prompts} ${r.prompts === 1 ? 'prompt' : 'prompts'}`,
    r.filesTotal ? `${r.filesTotal} ${r.filesTotal === 1 ? 'file' : 'files'} changed` : '',
    r.commits.length ? `${r.commits.length} ${r.commits.length === 1 ? 'commit' : 'commits'}` : '',
    r.compactions ? `compacted ${r.compactions}×` : ''
  ].filter(Boolean)
  const headline = r.ai ? r.ai.bullets[0] : latest?.text

  const summarizeButton = (
    <Button size="sm" variant="ghost" icon={busy ? Loader2 : Sparkles} className={busy ? 'spinning-icon' : ''} disabled={busy} onClick={summarize} title="Claude (Haiku) reads this recap and writes a short summary and a clear title. About $0.001 of your plan.">
      {busy ? 'Summarizing…' : r.ai ? 'Summarize again' : 'Summarize with Claude'}
    </Button>
  )

  const body = (
    <div className="recap-body">
      {r.ai ? (
        <div className="recap-ai">
          <ul>
            {r.ai.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          {r.ai.next && (
            <p className="recap-next">
              <strong>Still open:</strong> {r.ai.next}
            </p>
          )}
          <p className="muted small">Summary by Claude · {timeAgo(r.ai.at)}</p>
        </div>
      ) : (
        <div className="recap-prompts">
          {r.firstPrompts[0] && (
            <div>
              <span className="recap-label">You started with</span>
              <p className="recap-quote" data-no-brand>{r.firstPrompts[0].text}</p>
            </div>
          )}
          {latest && latest !== r.firstPrompts[0] && (
            <div>
              <span className="recap-label">Latest {latest.at ? `· ${timeAgo(latest.at)}` : ''}</span>
              <p className="recap-quote" data-no-brand>{latest.text}</p>
            </div>
          )}
        </div>
      )}
      {r.files.length > 0 && (
        <div className="recap-row">
          <span className="recap-label">Files</span>
          <div className="recap-files">
            {r.files.map((f) => (
              <span key={f.path} className="chip" title={`${f.path}\n${f.created ? 'Created, ' : ''}${f.edits} ${f.edits === 1 ? 'edit' : 'edits'}`}>
                {f.created ? <FilePlus2 size={11} /> : <FileCode2 size={11} />}
                {f.path.split(/[\\/]/).pop()}
              </span>
            ))}
            {r.filesTotal > r.files.length && <span className="muted small">+{r.filesTotal - r.files.length} more</span>}
          </div>
        </div>
      )}
      {r.commits.length > 0 && (
        <div className="recap-row">
          <span className="recap-label">Commits</span>
          <ul className="recap-commits">
            {r.commits.map((c) => (
              <li key={c}>
                <GitCommitHorizontal size={12} /> {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!r.ai && r.lastReply && (
        <div className="recap-row">
          <span className="recap-label">{tool === 'codex' ? 'Codex' : 'Claude'}’s last reply</span>
          <p className={`recap-reply ${showReply ? 'open' : ''}`}>{r.lastReply}</p>
          {r.lastReply.length > 280 && (
            <button className="link-btn small" onClick={() => setShowReply((v) => !v)}>
              {showReply ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      {compact && <div className="recap-actions">{summarizeButton}</div>}
    </div>
  )

  if (compact) {
    return (
      <div className={`recap recap-compact ${open ? 'open' : ''}`}>
        <div className="recap-banner">
          <History size={13} className="tone-accent" />
          <span className="recap-banner-text ellipsis" title={headline}>
            <strong>Last time:</strong> {headline}
          </span>
          <span className="muted small recap-banner-facts">{facts.slice(0, 3).join(' · ')}</span>
          <IconButton icon={open ? ChevronUp : ChevronDown} label={open ? 'Less' : 'What we worked on'} size={13} onClick={toggle} />
          {onClose && <IconButton icon={X} label="Hide" size={13} onClick={onClose} />}
        </div>
        {open && body}
      </div>
    )
  }

  return (
    <section className={`recap ${open ? 'open' : ''}`}>
      <div className="recap-head">
        <button className="recap-toggle" onClick={toggle} aria-expanded={open}>
          <History size={14} className="tone-accent" />
          <span className="strong">What we worked on</span>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <span className="muted small ellipsis">
          {span(r)}
          {facts.length ? ` · ${facts.join(' · ')}` : ''}
        </span>
        {summarizeButton}
      </div>
      {open ? body : headline && <p className="recap-collapsed muted small ellipsis">{headline}</p>}
    </section>
  )
}
