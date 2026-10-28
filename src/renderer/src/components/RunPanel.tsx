import { useEffect, useRef, useState } from 'react'
import { Copy, Pencil, Play, Plus, Square, Terminal, Trash2 } from 'lucide-react'
import type { AgentTool, Project, ProjectCommand, ProjectCommandRun, WorktreeInfo } from '@shared/types'
import type { LaunchOptions } from '../types'
import { Button, EmptyState, IconButton } from './ui'
import { useToast } from '../toast'
import { useSharedReadiness } from '../app/useReadiness'
import { errorMessage } from '../util'

export default function RunPanel({ project, onChanged, onLaunch, cwd = project.path, worktree }: { project: Project; onChanged: () => void; onLaunch: (opts: LaunchOptions) => void; cwd?: string; worktree?: WorktreeInfo }) {
  const toast = useToast()
  const [runs, setRuns] = useState<ProjectCommandRun[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProjectCommand | null>(null)
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const outputRef = useRef<HTMLPreElement>(null)
  const commands = project.meta.commands ?? []
  const { projects: readiness } = useSharedReadiness()
  const suggestions = readiness[project.path]?.result?.suggestions ?? []
  const activeId = commands.some(c => c.id === selected) ? selected : commands[0]?.id
  const current = runs.find(r => r.commandId === activeId)
  const live = (r?: ProjectCommandRun) => r?.state === 'running' || r?.state === 'stopping'
  useEffect(() => {
    const filter = (list: ProjectCommandRun[]) => setRuns(list.filter(r => r.projectPath.toLowerCase() === cwd.toLowerCase()))
    const off = window.mc.onProjectRunChanged(run => {
      if (run.projectPath.toLowerCase() === cwd.toLowerCase()) setRuns(list => [...list.filter(r => r.commandId !== run.commandId), run])
    })
    window.mc.projectRuns(cwd).then(filter).catch(e => toast('error', 'Could not load command output', errorMessage(e)))
    return off
  }, [cwd, toast])
  useEffect(() => { if (follow && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight }, [current?.output, follow])
  const save = async () => {
    if (!draft?.name.trim() || !draft.command.trim()) return
    setBusy(true)
    try {
      const latest = (await window.mc.listProjects()).find(p => p.path === project.path)
      if (!latest) throw new Error('Project is no longer available')
      const saved = latest.meta.commands ?? []
      if (saved.some(c => c.id !== draft.id && c.command.trim() === draft.command.trim())) {
        toast('info', 'Command already saved'); setDraft(null); onChanged(); return
      }
      const next = saved.some(c => c.id === draft.id) ? saved.map(c => c.id === draft.id ? draft : c) : [...saved, draft]
      await window.mc.setProjectMeta(project.path, { commands: next.map(c => ({ ...c, name: c.name.trim(), command: c.command.trim() })) })
      setSelected(draft.id); setDraft(null); onChanged()
    } catch (e) { toast('error', 'Could not save command', errorMessage(e)) } finally { setBusy(false) }
  }
  const start = async (id: string) => {
    setSelected(id); setStarting(id); setFollow(true)
    try {
      const run = await window.mc.startProjectCommand(project.path, id, cwd)
      setRuns(list => [...list.filter(r => r.commandId !== id), run])
    } catch (e) { toast('error', 'Could not run command', errorMessage(e)) } finally { setStarting(null) }
  }
  const remove = async (id: string) => {
    try {
      await window.mc.setProjectMeta(project.path, { commands: commands.filter(c => c.id !== id) })
      if (selected === id) setSelected(null)
      onChanged()
    } catch (e) { toast('error', 'Could not remove command', errorMessage(e)) }
  }
  const ask = async (tool: AgentTool) => {
    if (!current) return
    try {
      const report = await window.mc.projectCommandReport(current.id)
      onLaunch({ cwd: report.cwd, projectPath: project.path, projectName: project.name, title: project.name + ' - ' + current.name, kind: tool, args: [report.prompt], worktree })
    } catch (e) { toast('error', 'Could not prepare command report', errorMessage(e)) }
  }
  return <div className="run-panel">
    <header className="run-toolbar">
      <div><strong>Project commands</strong><div className="muted small">PowerShell · {cwd}</div></div>
      <Button size="sm" icon={Plus} onClick={() => setDraft({ id: crypto.randomUUID(), name: '', command: '' })}>Add command</Button>
    </header>
    {suggestions.length > 0 && <section className="run-editor" aria-label="Detected command suggestions"><strong>Detected package.json scripts</strong><p className="muted small">Review and edit each suggestion before saving. Saving does not run it or change automatic task checks.</p>{suggestions.map(suggestion => {
      const exists = commands.some(c => c.command.trim() === suggestion.command.trim())
      return <div key={suggestion.provenance.script} className="setup-actions"><code>{suggestion.command}</code><span className="muted small">package.json ? {suggestion.provenance.script} ({suggestion.provenance.manager})</span><Button size="sm" disabled={exists || busy} onClick={() => setDraft({ id: crypto.randomUUID(), name: suggestion.kind === 'test' ? 'Test' : 'Run app', command: suggestion.command })}>{exists ? 'Already saved' : 'Review suggestion'}</Button></div>
    })}</section>}
    {draft && <form className="run-editor" onSubmit={e => { e.preventDefault(); void save() }}>
      <label className="field"><span className="field-label">Name</span><input className="text-input" autoFocus placeholder="Start app, Test, Build…" maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="field"><span className="field-label">Command</span><textarea className="text-input mono" rows={2} maxLength={8000} placeholder="npm run dev" value={draft.command} onChange={e => setDraft({ ...draft, command: e.target.value })} /></label>
      <div className="run-actions"><Button type="submit" size="sm" variant="primary" disabled={busy || !draft.name.trim() || !draft.command.trim()}>Save command</Button><Button type="button" size="sm" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button></div>
    </form>}
    {!commands.length && !draft && <EmptyState icon={Terminal} title="Save the commands you run often"><p>Add Start app, Test, Build, or any PowerShell command. Run it here, inspect the output, and ask either agent to help with failures.</p></EmptyState>}
    <div className="run-workspace">
      <div className="run-list">
        {commands.map(c => {
          const r = runs.find(r => r.commandId === c.id)
          return <div key={c.id} className={`run-command ${activeId === c.id ? 'selected' : ''}`}>
            <button className="run-command-select" onClick={() => setSelected(c.id)}><strong>{c.name}</strong><code className="ellipsis">{c.command}</code><span className={`run-state ${r?.state ?? ''}`}>{r ? r.state : 'Not run'}</span></button>
            <div className="run-actions">
              {live(r) ? <IconButton icon={Square} label={`Stop ${c.name}`} disabled={r?.state === 'stopping'} onClick={() => void window.mc.stopProjectCommand(r!.id).catch(e => toast('error', 'Could not stop command', errorMessage(e)))} /> : <IconButton icon={Play} label={`Run ${c.name}`} disabled={starting === c.id} onClick={() => void start(c.id)} />}
              <IconButton icon={Pencil} label={`Edit ${c.name}`} disabled={live(r)} onClick={() => setDraft(c)} />
              <IconButton icon={Trash2} label={`Remove ${c.name}`} disabled={live(r)} onClick={() => void remove(c.id)} />
            </div>
          </div>
        })}
      </div>
      {commands.length > 0 && <section className="run-result">
        <div className="run-result-head"><strong>{current?.name ?? 'Output'}</strong><span className="muted small">{current ? `${current.state}${current.exitCode !== undefined ? ` · exit ${current.exitCode}` : ''}` : 'Choose a command and press Run'}</span></div>
        <pre ref={outputRef} className="run-output" aria-label="Command output">{current?.output || (live(current) ? 'Waiting for output…' : 'No output yet.')}</pre>
        <div className="run-result-foot">
          <label className="small"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow output</label>
          <Button size="sm" icon={Copy} disabled={!current?.output} onClick={() => void navigator.clipboard.writeText(current?.output ?? '').then(() => toast('success', 'Output copied')).catch(e => toast('error', 'Could not copy output', errorMessage(e)))}>Copy</Button>
          <Button size="sm" disabled={!current || live(current)} onClick={() => ask('claude')}>Ask Claude</Button>
          <Button size="sm" disabled={!current || live(current)} onClick={() => ask('codex')}>Ask Codex</Button>
        </div>
        <p className="muted tiny">Latest 64K characters shown. Results are kept until the app closes.</p>
      </section>}
    </div>
  </div>
}
