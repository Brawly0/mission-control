import { useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, Check, Copy, FilePlus2, Globe, Library, Play, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react'
import type { Project } from '@shared/types'
import { extractUrls, type PromptChatMessage, type PromptResource, type PromptSnippet, type PromptTarget } from '@shared/promptStudio'
import { errorMessage } from '../util'
import { useToast } from '../toast'
import { Button, IconButton, Segmented } from './ui'

interface Props {
  visible: boolean
  projects: Project[]
  selectedProject?: Project
  /** Starts a new agent whose first message is the prompt. */
  onSend: (tool: PromptTarget, prompt: string, project?: Project) => void
}

interface Turn extends PromptChatMessage {
  kind?: 'question' | 'prompt'
  title?: string
  used?: string[]
}

type Side = 'resources' | 'saved'

/** Prompt Studio (ADR 0035): talk about what you want, get a prompt tuned for Claude Code or Codex. */
export default function PromptStudioView({ visible, projects, selectedProject, onSend }: Props) {
  const toast = useToast()
  const [target, setTarget] = useState<PromptTarget>('claude')
  const [projectPath, setProjectPath] = useState<string>('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [side, setSide] = useState<Side>('resources')
  const [resources, setResources] = useState<PromptResource[]>([])
  const [snippets, setSnippets] = useState<PromptSnippet[]>([])
  const [editing, setEditing] = useState<{ id?: string; title: string; content: string } | null>(null)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const project = useMemo(() => projects.find((p) => p.path === projectPath) ?? selectedProject, [projects, projectPath, selectedProject])

  useEffect(() => {
    if (!visible) return
    void window.mc.listPromptResources().then(setResources).catch(() => setResources([]))
    void window.mc.listPromptSnippets().then(setSnippets).catch(() => setSnippets([]))
  }, [visible])
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [turns, busy])

  const ask = async (text: string) => {
    const clean = text.trim()
    if (!clean || busy) return
    const next: Turn[] = [...turns, { role: 'user', text: clean }]
    setTurns(next)
    setDraft('')
    setBusy(true)
    try {
      const reply = await window.mc.promptChat({
        target,
        projectName: project?.name,
        messages: next.map(({ role, text: t }) => ({ role, text: t }))
      })
      setTurns([...next, { role: 'assistant', text: reply.text, kind: reply.kind, title: reply.title, used: reply.usedResources }])
    } catch (e) {
      setTurns(turns)
      setDraft(clean)
      toast('error', 'Could not generate the prompt', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500)
    } catch (e) {
      toast('error', 'Could not copy', errorMessage(e))
    }
  }

  const saveSnippet = async (t: Turn) => {
    try {
      const s = await window.mc.savePromptSnippet({ title: t.title || 'Saved prompt', text: t.text, target })
      setSnippets((x) => [s, ...x])
      toast('success', 'Prompt saved', 'Find it under Saved.')
    } catch (e) {
      toast('error', 'Could not save', errorMessage(e))
    }
  }

  const saveResource = async () => {
    if (!editing) return
    try {
      const r = await window.mc.savePromptResource(editing)
      setResources((x) => [r, ...x.filter((y) => y.id !== r.id)])
      setEditing(null)
    } catch (e) {
      toast('error', 'Could not save', errorMessage(e))
    }
  }

  const importUrl = async () => {
    const urls = extractUrls(url)
    if (!urls.length || importing) return
    setImporting(true)
    const failed: string[] = []
    for (const u of urls) {
      try {
        const r = await window.mc.importPromptUrl(u)
        setResources((x) => [r, ...x.filter((y) => y.id !== r.id)])
      } catch (e) {
        failed.push(errorMessage(e))
      }
    }
    setImporting(false)
    if (failed.length) toast('error', `${failed.length} of ${urls.length} could not be added`, failed[0])
    else toast('success', urls.length === 1 ? 'Added to the library' : `Added ${urls.length} to the library`)
    if (failed.length < urls.length) setUrl('')
  }

  const importFiles = async () => {
    try {
      const added = await window.mc.importPromptFiles()
      if (added.length) setResources((x) => [...added, ...x])
    } catch (e) {
      toast('error', 'Could not add files', errorMessage(e))
    }
  }

  const toggle = async (r: PromptResource) => {
    const saved = await window.mc.savePromptResource({ ...r, enabled: !r.enabled })
    setResources((x) => x.map((y) => (y.id === saved.id ? saved : y)))
  }

  const removeResource = async (id: string) => {
    await window.mc.deletePromptResource(id)
    setResources((x) => x.filter((r) => r.id !== id))
  }

  const removeSnippet = async (id: string) => {
    await window.mc.deletePromptSnippet(id)
    setSnippets((x) => x.filter((s) => s.id !== id))
  }

  const lastPrompt = [...turns].reverse().find((t) => t.kind === 'prompt')
  const enabled = resources.filter((r) => r.enabled).length

  return (
    <div className="ps-view">
      <div className="ps-main">
        <header className="ps-head">
          <div>
            <h1>Prompt Studio</h1>
            <p className="muted">Say what you want. It asks what it needs, then writes the prompt for your agent.</p>
          </div>
          <div className="ps-controls">
            <Segmented
              value={target}
              onChange={(v) => setTarget(v as PromptTarget)}
              options={[
                { value: 'claude', label: 'Claude Code' },
                { value: 'codex', label: 'Codex' }
              ]}
            />
            <select className="ps-select" value={project?.path ?? ''} onChange={(e) => setProjectPath(e.target.value)} title="The project the prompt is for">
              <option value="">No project (quick chat)</option>
              {projects
                .filter((p) => !p.worktree)
                .map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name}
                  </option>
                ))}
            </select>
            {turns.length > 0 && <Button variant="ghost" icon={RotateCcw} onClick={() => setTurns([])}>New prompt</Button>}
          </div>
        </header>

        <div className="ps-thread scroll">
          {!turns.length && (
            <div className="ps-empty">
              <p>Describe the job in your own words, even if it is rough.</p>
              <div className="ps-examples">
                {['Fix the login bug where the session expires too early', 'Add dark mode to the settings page', 'Review my last commit for security problems'].map((ex) => (
                  <button key={ex} onClick={() => setDraft(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
              <p className="muted ps-hint">
                {enabled
                  ? `${enabled} resource${enabled === 1 ? '' : 's'} in your library will shape the result.`
                  : 'Add guides and example prompts on the right to teach it your style.'}
              </p>
            </div>
          )}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="ps-msg ps-user" data-no-brand>
                {t.text}
              </div>
            ) : t.kind === 'prompt' ? (
              <div key={i} className="ps-msg ps-result">
                <div className="ps-result-head">
                  <strong>{t.title || 'Your prompt'}</strong>
                  <span className="muted">for {target === 'codex' ? 'Codex' : 'Claude Code'}</span>
                </div>
                <pre className="ps-prompt">{t.text}</pre>
                {!!t.used?.length && <div className="muted ps-used">Learned from: {t.used.join(', ')}</div>}
                <div className="ps-actions">
                  <Button variant="primary" icon={copied === i ? Check : Copy} onClick={() => void copy(t.text, i)}>
                    {copied === i ? 'Copied' : 'Copy'}
                  </Button>
                  <Button icon={Play} onClick={() => onSend(target, t.text, project)} title={`Starts a new ${target === 'codex' ? 'Codex' : 'Claude'} agent with this as its first message`}>
                    Send to {target === 'codex' ? 'Codex' : 'Claude'}
                  </Button>
                  <Button variant="ghost" icon={BookMarked} onClick={() => void saveSnippet(t)}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div key={i} className="ps-msg ps-ai" data-no-brand>
                {t.text}
              </div>
            )
          )}
          {busy && <div className="ps-msg ps-ai muted">Thinking…</div>}
          <div ref={endRef} />
        </div>

        <form
          className="ps-input"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(draft)
          }}
        >
          <textarea
            value={draft}
            rows={2}
            placeholder={lastPrompt ? 'Ask for a change: shorter, add tests, use plan mode…' : turns.length ? 'Answer, or say "ok" to accept the defaults…' : 'What do you want the agent to do?'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask(draft)
              }
            }}
          />
          <Button variant="primary" icon={Send} type="submit" disabled={busy || !draft.trim()}>
            Send
          </Button>
        </form>
      </div>

      <aside className="ps-side">
        <Segmented
          value={side}
          onChange={(v) => setSide(v as Side)}
          options={[
            { value: 'resources', label: `Library (${resources.length})` },
            { value: 'saved', label: `Saved (${snippets.length})` }
          ]}
        />
        {side === 'resources' ? (
          <>
            <p className="muted ps-side-note">Guides, examples and your own rules. The most relevant ones are sent with each request.</p>
            <div className="ps-add">
              <input value={url} placeholder="Paste web or YouTube links…" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void importUrl()} />
              <IconButton icon={Globe} label="Add this page" onClick={() => void importUrl()} disabled={importing || !extractUrls(url).length} />
            </div>
            <div className="ps-add-row">
              <Button size="sm" icon={FilePlus2} onClick={() => void importFiles()}>
                Add files
              </Button>
              <Button size="sm" icon={Plus} onClick={() => setEditing({ title: '', content: '' })}>
                Write or paste
              </Button>
            </div>
            <div className="ps-list scroll">
              {!resources.length && (
                <div className="muted pad">
                  <Library size={16} /> Nothing yet. Try the Claude Code best-practices page, or paste three prompts that worked well for you.
                </div>
              )}
              {resources.map((r) => (
                <div key={r.id} className={`ps-item ${r.enabled ? '' : 'off'}`}>
                  <button className="ps-item-main" onClick={() => setEditing({ id: r.id, title: r.title, content: r.content })} title="Edit">
                    <span className="ps-item-title">{r.title}</span>
                    <span className="muted ps-item-meta">{Math.round(r.content.length / 1000) || '<1'}k chars{r.source ? ` · ${r.source.replace(/^https?:\/\//, '').slice(0, 40)}` : ''}</span>
                  </button>
                  <IconButton icon={r.enabled ? Check : X} label={r.enabled ? 'Used. Click to turn off' : 'Off. Click to turn on'} active={r.enabled} onClick={() => void toggle(r)} size={14} />
                  <IconButton icon={Trash2} label="Delete" onClick={() => void removeResource(r.id)} size={14} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="ps-list scroll">
            {!snippets.length && <div className="muted pad">Prompts you save show up here.</div>}
            {snippets.map((s) => (
              <div key={s.id} className="ps-item">
                <button className="ps-item-main" onClick={() => void navigator.clipboard.writeText(s.text).then(() => toast('success', 'Copied', s.title))} title="Copy">
                  <span className="ps-item-title">{s.title}</span>
                  <span className="muted ps-item-meta">{s.target === 'codex' ? 'Codex' : 'Claude Code'} · {s.text.slice(0, 60)}</span>
                </button>
                <IconButton icon={Play} label={`Send to ${s.target === 'codex' ? 'Codex' : 'Claude'}`} onClick={() => onSend(s.target, s.text, project)} size={14} />
                <IconButton icon={Trash2} label="Delete" onClick={() => void removeSnippet(s.id)} size={14} />
              </div>
            ))}
          </div>
        )}
      </aside>

      {editing && (
        <div className="ps-modal" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="ps-dialog">
            <h2>{editing.id ? 'Edit resource' : 'New resource'}</h2>
            <input value={editing.title} placeholder="Title (for example: My prompt style)" onChange={(e) => setEditing({ ...editing, title: e.target.value })} autoFocus />
            <textarea value={editing.content} rows={14} placeholder="Paste a guide, example prompts, or rules you want every prompt to follow…" onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            <div className="ps-dialog-actions">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void saveResource()} disabled={!editing.content.trim()}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
