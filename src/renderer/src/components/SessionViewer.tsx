import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import type { SessionDetail, SessionSummary } from '@shared/types'

interface Props {
  session: SessionSummary
  onResume: () => void
}

export default function SessionViewer({ session, onResume }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="session-viewer">
      <div className="session-viewer-header">
        <div>
          <div className="session-viewer-title">{session.title}</div>
          <div className="muted mono small">
            {session.id} · started {new Date(session.startedAt).toLocaleString()}
          </div>
        </div>
        <button className="btn primary" onClick={onResume}>
          ▶ Resume
        </button>
      </div>
      <div className="messages">
        {error && <div className="error">{error}</div>}
        {!detail && !error && <div className="muted pad">Reading chat…</div>}
        {detail?.truncated && <div className="muted pad">Showing the latest {detail.messages.length} messages.</div>}
        {detail?.messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="message-role">
              {m.role === 'user' ? 'You' : 'Claude'}
              {m.timestamp > 0 && <span className="muted"> · {new Date(m.timestamp).toLocaleString()}</span>}
            </div>
            <div className="message-text">
              {m.role === 'assistant' ? <Markdown>{m.text}</Markdown> : <pre>{m.text}</pre>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
