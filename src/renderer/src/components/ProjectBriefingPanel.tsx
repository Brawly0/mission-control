import { useEffect, useState } from 'react'
import { FileText, RefreshCw, Save } from 'lucide-react'
import type { Project } from '@shared/types'
import type { LaunchOptions } from '../types'
import { Button } from './ui'
import { Md } from './Md'
import { useToast } from '../toast'
import { errorMessage } from '../util'

export default function ProjectBriefingPanel({ project, onLaunch }: { project: Project; onLaunch: (opts: LaunchOptions) => void }) {
  const toast = useToast()
  const [markdown, setMarkdown] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(true)
  const [preview, setPreview] = useState(false)
  const dirty = markdown !== saved
  useEffect(() => {
    window.mc.projectBriefing(project.path).then(b => { setMarkdown(b.markdown); setSaved(b.markdown) }).catch(e => toast('error', 'Could not read briefing', errorMessage(e))).finally(() => setBusy(false))
  }, [project.path, toast])
  const refresh = async () => {
    setBusy(true)
    try { setMarkdown((await window.mc.draftProjectBriefing(project.path)).markdown) }
    catch (e) { toast('error', 'Could not refresh briefing', errorMessage(e)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try { await window.mc.saveProjectBriefing(project.path, markdown); setSaved(markdown); toast('success', 'Project briefing saved') }
    catch (e) { toast('error', 'Could not save briefing', errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <div className="run-panel briefing-panel">
    <div className="run-toolbar"><div><strong><FileText size={15} /> Shared project briefing</strong><p className="muted small">Goal, decisions and next steps for both agents. Saved to docs/BRIEFING.md.</p></div>
      <div className="run-actions"><Button size="sm" icon={RefreshCw} disabled={busy || dirty} onClick={() => void refresh()}>Refresh recent work</Button><Button size="sm" icon={Save} disabled={busy || !dirty} onClick={() => void save()}>Save briefing</Button></div></div>
    {!markdown && <p className="muted">Refresh to collect recent Claude and Codex chats, unfinished tasks, command checks and git state. Review and edit the draft before saving.</p>}
    <div className="run-actions"><Button size="sm" disabled={!markdown} onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</Button>{dirty && <span className="muted small">Unsaved draft — save before starting an agent.</span>}</div>
    {preview ? <div className="briefing-preview scroll"><Md>{markdown}</Md></div> : <textarea className="text-input mono briefing-editor" aria-label="Project briefing" value={markdown} onChange={e => setMarkdown(e.target.value)} maxLength={100000} placeholder="Current goal, decisions, constraints and next steps…" />}
    <div className="run-actions">{(['claude', 'codex'] as const).map(tool => <Button key={tool} size="sm" disabled={busy || dirty || !saved} onClick={() => onLaunch({ cwd: project.path, projectPath: project.path, projectName: project.name, title: project.name + ' - briefing', kind: tool })}>Start {tool === 'claude' ? 'Claude' : 'Codex'} from briefing</Button>)}</div>
    <p className="muted small">New empty sessions read the saved briefing automatically. Refresh keeps the goal, decisions and next steps above the generated section.</p>
  </div>
}
