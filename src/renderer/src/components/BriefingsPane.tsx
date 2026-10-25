import { useEffect, useState } from 'react'
import { Md } from './Md'
import { FileCheck2, FileText, Play, Save } from 'lucide-react'
import type { Briefing } from '@shared/types'
import { cleanBriefing } from '@shared/projectLook'
import { errorMessage, timeAgo } from '../util'
import { useToast } from '../toast'
import DocViewer from './DocViewer'
import { Avatar, Button, EmptyState } from './ui'

/**
 * Every session briefing in your chats: the summary Claude Code writes when a chat runs out of room.
 * New ones are saved to the project's docs/briefings/ automatically; older ones can be saved here.
 */
export function useBriefings(visible: boolean) {
  const toast = useToast()
  const [list, setList] = useState<Briefing[] | null>(null)
  const [current, setCurrent] = useState<Briefing | null>(null)

  const load = () =>
    window.mc.listBriefings().then((b) => {
      setList(b)
      setCurrent((cur) => (cur ? (b.find((x) => x.sessionId === cur.sessionId && x.at === cur.at) ?? b[0] ?? null) : (b[0] ?? null)))
    })
  useEffect(() => {
    if (visible) void load()
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (b: Briefing): Promise<string | null> => {
    try {
      const file = await window.mc.saveBriefing(b.sessionId, b.at)
      toast('success', 'Briefing saved', file)
      await load()
      return file
    } catch (e) {
      toast('error', 'Could not save the briefing', errorMessage(e))
      return null
    }
  }

  return { list, current, setCurrent, save }
}

type State = ReturnType<typeof useBriefings>

/** The list, for the left column. */
export function BriefingList({ state, query }: { state: State; query: string }) {
  const { list, current, setCurrent } = state
  const q = query.trim().toLowerCase()
  const shown = (list ?? []).filter((b) => !q || `${b.title} ${b.projectName} ${b.text}`.toLowerCase().includes(q))
  return (
      <div className="kn-scroll scroll briefings-list">
        {list === null && <div className="muted pad">Reading your chats…</div>}
        {list?.length === 0 && <div className="muted small pad">No briefings yet. One appears whenever a chat runs out of room and Claude Code compacts it.</div>}
        <ul>
          {shown.map((b) => (
            <li key={`${b.sessionId}:${b.at}`}>
              <button className={`kn-doc ${current?.sessionId === b.sessionId && current.at === b.at ? 'selected' : ''}`} onClick={() => setCurrent(b)}>
                <Avatar name={b.projectName} path={b.projectPath} size={18} />
                <span className="kn-doc-text">
                  <span className="ellipsis">{b.title || 'Untitled chat'}</span>
                  <span className="muted tiny ellipsis">
                    {b.projectName} · {timeAgo(b.at)} · {b.trigger === 'manual' ? '/compact' : 'hit the limit'}
                    {b.preTokens ? ` at ${Math.round(b.preTokens / 1000)}K` : ''}
                  </span>
                </span>
                {b.savedPath && <FileCheck2 size={13} className="tone-green briefing-saved" aria-label="Saved" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
  )
}

/** The selected briefing, for the right column. */
export function BriefingDetail({ state, onStartFromBriefing }: { state: State; onStartFromBriefing: (projectPath: string, file: string) => void }) {
  const { list, current, save } = state
  return (
    <>
      {current && (
        <div className="briefing-detail">
          <div className="briefing-actions">
            <span className="muted small ellipsis">{current.savedPath ? `Saved: ${current.savedPath}` : 'Not saved as a file yet'}</span>
            {!current.savedPath && (
              <Button size="sm" icon={Save} onClick={() => void save(current)}>
                Save to project
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              icon={Play}
              onClick={async () => {
                const file = current.savedPath ?? (await save(current))
                if (file) onStartFromBriefing(current.projectPath, file)
              }}
            >
              New session from this
            </Button>
          </div>
          {current.savedPath ? (
            <DocViewer key={current.savedPath} doc={{ name: current.savedPath.split(/[\\/]/).pop() ?? 'briefing.md', path: current.savedPath }} subtitle={current.projectName} />
          ) : (
            <div className="markdown scroll briefing-text">
              <h1>Session briefing: {current.title || 'Untitled chat'}</h1>
              <Md>{cleanBriefing(current.text)}</Md>
            </div>
          )}
        </div>
      )}
      {!current && list && list.length > 0 && (
        <EmptyState icon={FileText} title="Pick a briefing">
          Its summary shows here.
        </EmptyState>
      )}
    </>
  )
}
