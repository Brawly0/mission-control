import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitBranch, GitCommitHorizontal, GitMerge, RefreshCw, Trash2, X } from 'lucide-react'
import type { GitChanges, WorktreeInfo } from '@shared/types'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import DiffView, { parseDiff } from './DiffView'
import { Button, EmptyState, IconButton } from './ui'

interface Props {
  path: string
  worktree?: WorktreeInfo
  visible: boolean
  /** Called after a merge or discard so the caller can refresh git badges. */
  onChanged?: () => void
  /** Called after the worktree was deleted. */
  onDiscarded?: () => void
  onClose?: () => void
}

const STATUS_LABEL: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflict', '?': 'New' }

export default function ChangesPanel({ path, worktree, visible, onChanged, onDiscarded, onClose }: Props) {
  const toast = useToast()
  const [changes, setChanges] = useState<GitChanges | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [commitMsg, setCommitMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const c = await window.mc.getChanges(path, worktree?.base)
      setChanges(c)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [path, worktree?.base])

  useEffect(() => {
    if (!visible) return
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [visible, load])

  const fileDiffs = useMemo(() => parseDiff(changes?.diff ?? ''), [changes])
  const byPath = useMemo(() => new Map(fileDiffs.map((f) => [f.path, f])), [fileDiffs])
  const files = changes?.files ?? []
  const activePath = selected && files.some((f) => f.path === selected) ? selected : files[0]?.path
  const totals = fileDiffs.reduce((t, f) => ({ add: t.add + f.added, del: t.del + f.removed }), { add: 0, del: 0 })

  const run = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await fn()
      toast('success', success)
      await load()
      onChanged?.()
    } catch (e) {
      toast('error', `${label} failed`, errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const commit = () =>
    run('Commit', () => window.mc.commitAll(path, commitMsg!.trim()), 'Changes committed').then(() => setCommitMsg(null))

  return (
    <div className="changes">
      <div className="changes-head">
        <div className="changes-title">
          {worktree ? (
            <span className="branch-flow">
              <GitBranch size={14} />
              <code>{worktree.branch}</code>
              <span className="muted">→</span>
              <code>{worktree.base}</code>
            </span>
          ) : (
            <span>Uncommitted changes</span>
          )}
          {files.length > 0 && (
            <span className="muted small">
              {files.length} {files.length === 1 ? 'file' : 'files'} · <span className="tone-green">+{totals.add}</span>{' '}
              <span className="tone-red">−{totals.del}</span>
            </span>
          )}
        </div>
        <div className="toolbar">
          <IconButton icon={RefreshCw} label="Refresh" size={14} onClick={load} />
          {files.length > 0 && commitMsg === null && (
            <Button size="sm" icon={GitCommitHorizontal} onClick={() => setCommitMsg('')} disabled={busy}>
              Commit all
            </Button>
          )}
          {worktree && (
            <>
              <Button
                size="sm"
                variant="primary"
                icon={GitMerge}
                disabled={busy || !changes || changes.commits.length === 0}
                title={changes?.commits.length ? `Merge into ${worktree.base}` : 'Nothing committed to merge yet'}
                onClick={() => run('Merge', () => window.mc.mergeWorktree(worktree), `Merged into ${worktree.base}`)}
              >
                Merge
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                disabled={busy}
                onClick={async () => {
                  try {
                    if (await window.mc.removeWorktree(worktree)) {
                      toast('success', 'Worktree deleted', worktree.branch)
                      onChanged?.()
                      onDiscarded?.()
                    }
                  } catch (e) {
                    toast('error', 'Could not delete worktree', errorMessage(e))
                  }
                }}
              >
                Discard
              </Button>
            </>
          )}
          {onClose && <IconButton icon={X} label="Close" size={15} onClick={onClose} />}
        </div>
      </div>

      {commitMsg !== null && (
        <form
          className="commit-bar"
          onSubmit={(e) => {
            e.preventDefault()
            if (commitMsg.trim()) commit()
          }}
        >
          <input autoFocus placeholder="Commit message" value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} />
          <Button size="sm" variant="primary" type="submit" disabled={!commitMsg.trim() || busy}>
            Commit {files.length} {files.length === 1 ? 'file' : 'files'}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setCommitMsg(null)}>
            Cancel
          </Button>
        </form>
      )}

      {changes && changes.commits.length > 0 && (
        <div className="commit-list">
          {changes.commits.slice(0, 5).map((c) => (
            <div key={c} className="commit-line">
              <GitCommitHorizontal size={13} />
              <code>{c.slice(0, 7)}</code>
              <span className="ellipsis">{c.slice(8)}</span>
            </div>
          ))}
          {changes.commits.length > 5 && <div className="muted small">and {changes.commits.length - 5} more</div>}
        </div>
      )}

      {error ? (
        <div className="error pad">{error}</div>
      ) : !changes ? (
        <div className="muted pad">Reading changes…</div>
      ) : files.length === 0 ? (
        <EmptyState icon={GitBranch} title={changes.commits.length ? 'Everything is committed' : 'No changes yet'}>
          {worktree
            ? changes.commits.length
              ? `Merge to bring ${changes.commits.length} ${changes.commits.length === 1 ? 'commit' : 'commits'} into ${worktree.base}.`
              : 'Files the agent changes in its worktree show up here.'
            : 'The working tree is clean.'}
        </EmptyState>
      ) : (
        <div className="changes-body">
          <ul className="file-list">
            {files.map((f) => {
              const d = byPath.get(f.path)
              return (
                <li key={f.path}>
                  <button className={f.path === activePath ? 'selected' : ''} onClick={() => setSelected(f.path)} title={`${STATUS_LABEL[f.status] ?? f.status}: ${f.path}`}>
                    <span className={`file-status st-${f.status === '?' ? 'N' : f.status}`}>{f.status === '?' ? 'N' : f.status}</span>
                    <span className="file-path">
                      <span className="file-name">{f.path.split('/').pop()}</span>
                      <span className="file-dir">{f.path.split('/').slice(0, -1).join('/')}</span>
                    </span>
                    {d && (
                      <span className="file-counts">
                        {d.added > 0 && <span className="tone-green">+{d.added}</span>}
                        {d.removed > 0 && <span className="tone-red">−{d.removed}</span>}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <DiffView file={activePath ? byPath.get(activePath) : undefined} />
        </div>
      )}
    </div>
  )
}
