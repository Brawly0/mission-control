import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, GitCommitHorizontal, GitMerge, RefreshCw, Trash2, X } from 'lucide-react'
import type { GitChanges, ProjectReview, WorktreeInfo } from '@shared/types'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import DiffView, { parseDiff } from './DiffView'
import { Button, EmptyState, IconButton, MenuButton } from './ui'
import { Md } from './Md'

interface Props {
  path: string
  worktree?: WorktreeInfo
  visible: boolean
  /** Called after a merge or discard so the caller can refresh git badges. */
  onChanged?: () => void
  /** Called after the worktree was deleted. */
  onDiscarded?: () => void
  onClose?: () => void
  /** Current displayed snapshot and explicit review acknowledgement; undefined on failure. */
  onInspectChanges?: (fingerprint: string | undefined, inspected: boolean) => void
}

const STATUS_LABEL: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflict', '?': 'New' }

export default function ChangesPanel({ path, worktree, visible, onChanged, onDiscarded, onClose, onInspectChanges }: Props) {
  const toast = useToast()
  const [changes, setChanges] = useState<GitChanges | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [commitMsg, setCommitMsg] = useState<string | null>(null)
  const [review, setReview] = useState<ProjectReview | null>(null)
  const [checkDraft, setCheckDraft] = useState<string | null>(null)
  const [approved, setApproved] = useState<string | null>(null)
  const generation = useRef(0)
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const owner = generation.current
    const request = ++latestLoad.current
    try {
      const snapshot = await window.mc.projectReview(path, worktree?.base)
      if (generation.current !== owner || latestLoad.current !== request) return
      setReview(snapshot)
      setChanges(snapshot.changes)
      setError(null)
    } catch (e) {
      if (generation.current !== owner || latestLoad.current !== request) return
      setError(errorMessage(e))
    }
  }, [path, worktree?.base])

  useEffect(() => {
    generation.current++
    setReview(null)
    setChanges(null)
    setApproved(null)
    setError(null)
    if (!visible) return
    load()
    const timer = setInterval(load, 5000)
    return () => { generation.current++; clearInterval(timer) }
  }, [visible, load])

  const fileDiffs = useMemo(() => parseDiff(changes?.diff ?? ''), [changes])
  const byPath = useMemo(() => new Map(fileDiffs.map((f) => [f.path, f])), [fileDiffs])
  const files = changes?.files ?? []
  const activePath = selected && files.some((f) => f.path === selected) ? selected : files[0]?.path
  const totals = fileDiffs.reduce((t, f) => ({ add: t.add + f.added, del: t.del + f.removed }), { add: 0, del: 0 })
  const checksPassed = !review?.checkCommand || (review.check?.state === 'passed' && !review.checkStale)
  const approvalKey = review ? `${review.fingerprint}:${review.check?.id ?? ''}:${review.check?.state ?? ''}:${review.review?.id ?? ''}:${review.review?.run?.finishedAt ?? ''}` : ''
  const approvedNow = !!review && approved === approvalKey
  useEffect(() => {
    if (visible) onInspectChanges?.(error ? undefined : review?.fingerprint, !error && approvedNow)
  }, [visible, error, review?.fingerprint, approvedNow, onInspectChanges])
  const canMerge = approvedNow && checksPassed && files.length === 0 && !!changes?.commits.length
  const checkTone = !review?.checkCommand ? 'neutral' : review.checkStale ? 'warning' : review.check?.state === 'passed' ? 'success' : review.check?.state === 'failed' ? 'danger' : review.check?.state === 'running' || review.check?.state === 'stopping' ? 'info' : 'neutral'
  const checkLabel = !review?.checkCommand ? 'Not configured' : review.checkStale ? 'Out of date' : !review.check ? 'Not run' : { running: 'Running', stopping: 'Stopping', passed: 'Passed', failed: 'Failed', stopped: 'Stopped' }[review.check.state]
  const agentTone = review?.reviewStale ? 'warning' : review?.review?.run?.error ? 'danger' : review?.review ? 'info' : 'neutral'
  const agentLabel = review?.reviewStale ? 'Out of date' : review?.review?.column === 'running' ? 'In progress' : review?.review?.run?.error ? 'Failed' : review?.review?.run?.finishedAt ? 'Complete' : 'Optional'


  const run = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await fn()
      toast('success', success)
      await load()
      onChanged?.()
      return true
    } catch (e) {
      toast('error', `${label} failed`, errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const commit = () =>
    run('Commit', () => window.mc.commitAll(path, commitMsg!.trim()), 'Changes committed').then(ok => { if (ok) setCommitMsg(null) })

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
                disabled={busy || !canMerge}
                title={canMerge ? `Merge into ${worktree.base}` : 'Review the diff, commit changes, and run configured checks before merging'}
                onClick={() => run('Merge', () => window.mc.mergeReviewedWorktree(worktree, review!.fingerprint), `Merged into ${worktree.base}`)}
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

      {review && <section className="review-summary" aria-label="Review status">
        <div className="review-summary-heading"><strong>{worktree && canMerge ? 'Ready to merge' : approvedNow ? 'Diff reviewed' : files.length || changes?.commits.length ? 'Review changes' : 'Working tree clean'}</strong><span className="muted small">{files.length} {files.length === 1 ? 'file' : 'files'} · <span className="tone-green">+{totals.add}</span> <span className="tone-red">−{totals.del}</span></span></div>
        <div className="review-status-grid" aria-live="polite">
          <div className={`review-status-card tone-${approvedNow ? 'success' : 'neutral'}`}><span className="review-step">01 / Diff</span><strong>{approvedNow ? 'Reviewed' : files.length || changes?.commits.length ? 'Needs review' : 'Clean'}</strong><span>{approvedNow ? 'Current snapshot' : 'Inspect the files below'}</span></div>
          <div className={`review-status-card tone-${checkTone}`}><span className="review-step">02 / Checks</span><strong>{checkLabel}</strong><span>{review.checkStale ? 'Rerun on current files' : review.check?.exitCode !== undefined ? `Exit code ${review.check.exitCode}` : review.checkCommand ? 'Project verification' : 'Set up a command'}</span></div>
          <div className={`review-status-card tone-${agentTone}`}><span className="review-step">03 / Agent review</span><strong>{agentLabel}</strong><span>{review.review ? `${review.review.tool === 'codex' ? 'Codex' : 'Claude'} / read-only` : 'Get a second opinion'}</span></div>
        </div>
        <div className="review-primary-actions">
          <Button size="sm" disabled={busy || !review.checkCommand || review.check?.state === 'running' || review.check?.state === 'stopping'} onClick={() => void run('Checks', () => window.mc.startReviewChecks(path, worktree?.base), 'Checks started')}>Run checks</Button>
          {review.check?.state === 'running' && <Button size="sm" onClick={() => void window.mc.stopProjectCommand(review.check!.id).then(load)}>Stop checks</Button>}
          <MenuButton portal align="right" trigger={toggle => <Button size="sm" disabled={busy || review.review?.column === 'running'} onClick={toggle}>Agent review</Button>} items={(['codex', 'claude'] as const).map(tool => ({ label: `Review with ${tool === 'codex' ? 'Codex' : 'Claude'}`, onSelect: () => void run('Review', () => window.mc.startCodeReview(path, worktree?.base, tool), 'Read-only review started') }))} />
          <label className="review-approval"><input type="checkbox" checked={approvedNow} onChange={e => setApproved(e.target.checked ? approvalKey : null)} /> Reviewed this diff and results</label>
        </div>
        <details className="review-config" open={!review.checkCommand}><summary>Check setup <code className="ellipsis">{review.checkCommand || 'Choose a verification command'}</code></summary><div className="review-check-command run-actions">
          <input className="text-input mono" aria-label="Project check command" placeholder="e.g. npm test" value={checkDraft ?? review.checkCommand} onChange={e => setCheckDraft(e.target.value)} />
          {checkDraft !== null && <Button size="sm" disabled={busy} onClick={() => void run('Save checks', () => window.mc.setProjectMeta(review.projectPath, { checkCommand: checkDraft.trim() }), 'Check command saved').then(ok => { if (ok) setCheckDraft(null) })}>Save</Button>}
        </div></details>
        {review.check?.output && <details className="review-output"><summary>Check output <span className={`review-state-badge tone-${checkTone}`}>{checkLabel}</span></summary><pre className="review-check-output">{review.check.output}</pre></details>}
        {review.review && <details className="review-output"><summary>Agent findings <span className={`review-state-badge tone-${agentTone}`}>{agentLabel}</span></summary><div className="review-agent-result">{review.review.run?.error || (review.review.run?.result ? <Md>{review.review.run.result}</Md> : review.review.run?.activity)}</div></details>}
      </section>}

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
