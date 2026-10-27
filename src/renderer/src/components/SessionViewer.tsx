import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Md } from './Md'
import { Copy, Play, Sparkles } from 'lucide-react'
import type { SessionDetail, SessionSummary } from '@shared/types'
import { useToast } from '../toast'
import { Button, IconButton, ToolBadge } from './ui'
import SessionRecap from './SessionRecap'

interface Props {
  session: SessionSummary
  onResume: () => void
  /** Extra buttons for the header, e.g. Move to project. */
  actions?: ReactNode
  /** Claude gave the chat a new title (Summarize). */
  onTitleChanged?: () => void
}

export default function SessionViewer({ session, onResume, actions, onTitleChanged }: Props) {
  const toast = useToast()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    window.mc
      .getSession(session.projectKey, session.id)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [session.projectKey, session.id])

  // Open at the end of the conversation, where the latest work is.
  useEffect(() => {
    if (detail && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [detail])

  return (
    <div className="session-viewer">
      <div className="session-viewer-head">
        <div className="session-viewer-title">
          <div className="ellipsis strong session-viewer-name">
            {session.tool === 'codex' && <ToolBadge tool="codex" />}
            {session.title}
            {session.titleSource === 'claude' && (
              <span title="Named by Claude. Rename it to use your own." className="named-by-claude">
                <Sparkles size={12} />
              </span>
            )}
          </div>
          <div className="muted small">
            Started {new Date(session.startedAt).toLocaleString()}
            {detail && ` · ${detail.messages.length} messages`}
            {session.movedFrom && ` · started in ${session.movedFrom}`}
          </div>
        </div>
        {actions}
        <IconButton
          icon={Copy}
          label="Copy session id"
          size={14}
          onClick={() => {
            navigator.clipboard.writeText(session.id)
            toast('info', 'Session id copied', session.id)
          }}
        />
        <Button variant="primary" size="sm" icon={Play} onClick={onResume}>
          Resume
        </Button>
      </div>
      <SessionRecap key={session.id} sessionId={session.id} version={session.updatedAt} onTitle={onTitleChanged} tool={session.tool} />
      <div className="messages scroll" ref={scrollRef}>
        {error && <div className="error">{error}</div>}
        {!detail && !error && <div className="muted pad">Reading chat…</div>}
        {detail?.truncated && <div className="muted pad center">Showing the latest {detail.messages.length} messages</div>}
        {detail?.messages.map((m, i) => (
          <div key={i} className={`message ${m.role} ${session.tool === 'codex' ? 'from-codex' : ''}`}>
            <div className="message-role">
              {m.role === 'user' ? 'You' : session.tool === 'codex' ? 'Codex' : 'Claude'}
              {m.timestamp > 0 && (
                <span className="message-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <div className="message-text">
              {m.role === 'assistant' ? <Md>{m.text}</Md> : <div className="user-text">{m.text}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
