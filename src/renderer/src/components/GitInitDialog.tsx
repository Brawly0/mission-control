import { useEffect, useState } from 'react'
import { AlertTriangle, GitBranch, ShieldCheck, X } from 'lucide-react'
import type { GitInitPreview, Project } from '@shared/types'
import { errorMessage, formatBytes } from '../util'
import { useToast } from '../toast'
import { Button, IconButton } from './ui'

/** Shows what "Turn on git" would commit, and only then does it. */
export default function GitInitDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<GitInitPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.mc.previewGitInit(project.path).then(setPreview).catch((e) => setError(errorMessage(e)))
  }, [project.path])

  const go = async () => {
    setBusy(true)
    try {
      const res = await window.mc.initGit(project.path)
      toast('success', 'Git is on', `${project.name}: first commit ${res.commit} with ${res.files} files. Worktrees and Review now work here.`)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog git-init" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dialog-head">
          <h2>
            <GitBranch size={16} /> Turn on git for {project.name}
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">
          <p className="muted">
            This makes the folder a git repository on this computer (nothing is uploaded anywhere), adds ignore rules, and saves a first commit of the files below. After that, tasks can run in their own worktrees, and you can review and merge their changes.
          </p>
          {error && <div className="run-error">{error}</div>}
          {!preview && !error && <div className="muted pad">Looking at the folder…</div>}
          {preview?.alreadyRepo && <div className="muted pad">This folder is already a git repository.</div>}
          {preview && !preview.alreadyRepo && (
            <>
              <div className="init-summary">
                <div>
                  <div className="hero-value">{preview.fileCount.toLocaleString()}</div>
                  <div className="muted small">files in the first commit</div>
                </div>
                <div>
                  <div className="hero-value">{formatBytes(preview.totalBytes)}</div>
                  <div className="muted small">total size</div>
                </div>
              </div>
              {preview.large.length > 0 && (
                <div className="init-warn">
                  <AlertTriangle size={14} />
                  <div>
                    Large files will be committed: {preview.large.map((f) => `${f.path} (${formatBytes(f.bytes)})`).join(', ')}. Add them to .gitignore first if they shouldn’t be in the history.
                  </div>
                </div>
              )}
              {preview.secretsExcluded.length > 0 && (
                <div className="init-ok">
                  <ShieldCheck size={14} />
                  <div>Kept out because they look secret: {preview.secretsExcluded.join(', ')}</div>
                </div>
              )}
              {preview.gitignoreAdditions.length > 0 && (
                <details className="init-details">
                  <summary>
                    {preview.gitignoreExists ? 'Adds' : 'Creates .gitignore with'} {preview.gitignoreAdditions.length} rules (dependencies, build output, secrets, logs)
                  </summary>
                  <pre>{preview.gitignoreAdditions.join('\n')}</pre>
                </details>
              )}
              <details className="init-details" open={preview.fileCount <= 30}>
                <summary>Files to commit{preview.fileCount > preview.files.length ? ` (first ${preview.files.length})` : ''}</summary>
                <pre>{preview.files.join('\n') || '(no files: the commit will only contain .gitignore)'}</pre>
              </details>
            </>
          )}
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={GitBranch} onClick={go} disabled={!preview || preview.alreadyRepo || busy}>
            {busy ? 'Setting up…' : 'Turn on git'}
          </Button>
        </div>
      </div>
    </div>
  )
}
