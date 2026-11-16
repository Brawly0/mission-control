import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Check, CornerDownLeft, FileDiff, ImagePlus, MessageSquareText, ShieldQuestion, Square, TerminalSquare, X } from 'lucide-react'
import { baseName, isPermissionPrompt } from '@shared/agentActivity'
import { sendPrompt } from '@shared/terminalInput'
import type { Agent } from '../types'
import type { DisplayStatus } from '../agentStatus'
import { FOCUS_TERMINAL_EVENT } from './TerminalPane'

const toolName = (a: Agent) => (a.kind === 'codex' ? 'Codex' : 'Claude')
export const focusTerminal = (id: string) => window.dispatchEvent(new CustomEvent(FOCUS_TERMINAL_EVENT, { detail: id }))

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** Re-renders every second while `on`, for live timers. */
function useTick(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

/** The line under an agent's header: what it's doing right now, how long it's been at it, and what it changed. */
export function ActivityStrip({ agent, st, onReview, composerOn, onToggleComposer }: {
  agent: Agent
  st: DisplayStatus
  /** Opens the review panel; undefined when the folder isn't a git repo. */
  onReview?: () => void
  composerOn?: boolean
  onToggleComposer?: () => void
}) {
  const working = st.cls === 'working'
  const now = useTick(working)
  const act = agent.activity
  let text: string
  let detail = ''
  if (st.cls === 'working') {
    if (act) {
      text = act.verb
      detail = act.target
    } else text = agent.kind === 'mc' ? 'Working' : 'Thinking'
  } else if (st.cls === 'needs-input') {
    // The approval bar right below spells out the request; the strip just says what's going on.
    text = 'Waiting for you'
  }
  else if (st.cls === 'done') text = 'Done · your turn'
  else if (st.cls === 'ready') text = 'Ready for a prompt'
  else if (st.cls === 'exited') text = st.label
  else text = 'Idle'
  const since = working ? (act?.at ?? agent.statusAt) : undefined
  const edited = agent.edited ?? []

  return (
    <div className={`activity-strip act-${st.cls}`} role="status" aria-live="polite">
      <span className="act-orb" aria-hidden />
      <span className="act-text ellipsis" title={detail ? `${text} ${detail}` : text}>
        <span className="act-verb">{text}</span>
        {detail && <span className="act-detail"> {detail}</span>}
        {working && !act && <span className="act-dots" aria-hidden><i /><i /><i /></span>}
      </span>
      {since && <span className="act-time">{elapsed(now - since)}</span>}
      <span className="act-spacer" />
      {edited.length > 0 && (
        <button
          className="act-chip"
          disabled={!onReview}
          onClick={(e) => { e.stopPropagation(); onReview?.() }}
          title={`${edited.length} ${edited.length === 1 ? 'file' : 'files'} changed this session:\n${edited.slice(-12).map(baseName).join('\n')}${onReview ? '\n\nClick to review the diff' : ''}`}
        >
          <FileDiff size={11} /> {edited.length} {edited.length === 1 ? 'file' : 'files'} changed
        </button>
      )}
      {onToggleComposer && (
        <button className={`act-toggle ${composerOn ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleComposer() }} title={composerOn ? 'Hide the prompt box (type in the terminal instead)' : 'Show the prompt box'}>
          <MessageSquareText size={12} />
        </button>
      )}
    </div>
  )
}

/** What a permission prompt is waiting on, and the keys that answer it in each CLI. */
export function approvalFor(agent: Agent, st: DisplayStatus): { title: string; detail?: string; allow: string; deny?: string; allowLabel: string } | null {
  if (st.cls !== 'needs-input' || agent.exited) return null
  if (agent.kind === 'codex') {
    if (/trust/i.test(agent.statusMessage ?? '')) return { title: 'Codex asks whether to trust this folder', allow: '\r', allowLabel: 'Trust folder' }
    if (/approv/i.test(agent.statusMessage ?? '')) return { title: 'Codex wants to run something', allow: 'y', deny: '\x1b', allowLabel: 'Allow' }
    return null
  }
  if (agent.kind !== 'claude' || !isPermissionPrompt(agent.statusMessage)) return null
  const act = agent.activity
  return {
    title: agent.statusMessage || 'Claude needs your permission',
    detail: act ? `${act.verb} ${act.target}`.trim() : undefined,
    // Claude's permission menu starts on "Yes"; Esc is "No, and tell Claude what to do differently".
    allow: '\r',
    deny: '\x1b',
    allowLabel: 'Allow'
  }
}

/** Allow / Deny buttons for a permission prompt, so you don't have to find the menu in the terminal. */
export function ApprovalBar({ agent, st }: { agent: Agent; st: DisplayStatus }) {
  // Hidden once answered, until the agent asks again (its status time changes).
  const [answered, setAnswered] = useState<number | undefined>(undefined)
  const ask = approvalFor(agent, st)
  if (!ask || (answered !== undefined && answered === agent.statusAt)) return null
  const answer = (keys: string) => {
    window.mc.ptyWrite(agent.id, keys)
    setAnswered(agent.statusAt)
  }
  return (
    <div className="approval-bar">
      <ShieldQuestion size={15} className="approval-icon" />
      <span className="approval-text ellipsis">
        <span className="strong">{ask.title}</span>
        {ask.detail && <code className="approval-detail">{ask.detail}</code>}
      </span>
      <button className="approval-btn allow" onClick={() => answer(ask.allow)} title="Answer yes once (you'll be asked again next time)">
        <Check size={13} /> {ask.allowLabel}
      </button>
      {ask.deny && (
        <button className="approval-btn deny" onClick={() => answer(ask.deny!)} title={`Say no; ${toolName(agent)} waits for you to say what to do instead`}>
          <X size={13} /> Deny
        </button>
      )}
      <button className="approval-btn ghost" onClick={() => focusTerminal(agent.id)} title="See every option in the terminal (e.g. allow for the whole session)">
        <TerminalSquare size={13} /> More
      </button>
    </div>
  )
}

const HISTORY_KEY = 'mc.promptHistory'
function loadHistory(): string[] {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(h) ? h.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
function pushHistory(text: string): void {
  try {
    const h = loadHistory().filter((x) => x !== text)
    h.push(text)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-100)))
  } catch {
    /* just not remembered */
  }
}

/** Slash commands offered under the prompt box; the ones that open a menu hand the keyboard to the terminal. */
const QUICK: Record<'claude' | 'codex', { cmd: string; label: string; menu?: boolean; title: string }[]> = {
  claude: [
    { cmd: '/compact', label: 'Compact', title: 'Summarize the chat so far and continue from the summary' },
    { cmd: '/clear', label: 'Clear', title: 'Start a fresh chat in this terminal' },
    { cmd: '/context', label: 'Context', title: 'Show what fills the context window' },
    { cmd: '/model', label: 'Model', menu: true, title: 'Pick the model' }
  ],
  codex: [
    { cmd: '/compact', label: 'Compact', title: 'Summarize the chat so far and continue from the summary' },
    { cmd: '/new', label: 'New chat', title: 'Start a fresh chat in this terminal' },
    { cmd: '/status', label: 'Status', title: 'Show the model, limits and context used' },
    { cmd: '/model', label: 'Model', menu: true, title: 'Pick the model' }
  ]
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/png' })
}

/** A path as the agent should get it: @relative for Claude inside the project, quoted when it has spaces. */
export function pathForPrompt(path: string, cwd: string, tool: 'claude' | 'codex'): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = norm(cwd)
  const full = norm(path)
  const inside = full.toLowerCase().startsWith(base.toLowerCase() + '/')
  const shown = inside ? full.slice(base.length + 1) : path
  const quoted = /\s/.test(shown) ? `"${shown}"` : shown
  return inside && tool === 'claude' && !/\s/.test(shown) ? `@${shown}` : quoted
}

/**
 * A chat-style prompt box under an agent's terminal: Enter sends, Shift+Enter adds a line, ↑/↓ walk your
 * past prompts, pasted screenshots and dropped files go in as paths. Esc in an empty box interrupts the agent.
 */
export function PromptComposer({ agent, st, focusNow }: { agent: Agent; st: DisplayStatus; focusNow: boolean }) {
  const tool = agent.kind === 'codex' ? 'codex' : 'claude'
  const [text, setText] = useState('')
  const [hist, setHist] = useState<{ list: string[]; at: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focusNow) requestAnimationFrame(() => ref.current?.focus())
  }, [focusNow])

  // Grow with the text, up to about eight lines.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 170)}px`
  }, [text])

  const write = (data: string) => window.mc.ptyWrite(agent.id, data)
  const send = () => {
    const t = text.trim()
    if (!t) {
      write('\r')
      return
    }
    if (sendPrompt(write, t)) {
      pushHistory(t)
      setText('')
      setHist(null)
    }
  }
  const insert = (s: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const pad = start > 0 && !/\s$/.test(text.slice(0, start)) ? ' ' : ''
    const next = `${text.slice(0, start)}${pad}${s} ${text.slice(end)}`
    setText(next)
    requestAnimationFrame(() => {
      const pos = start + pad.length + s.length + 1
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (text) setText('')
      else write('\x1b')
    } else if (e.key === 'ArrowUp' && el.selectionStart === 0 && el.selectionEnd === 0) {
      const list = hist?.list ?? loadHistory()
      const at = (hist?.at ?? list.length) - 1
      if (at < 0) return
      e.preventDefault()
      setHist({ list, at })
      setText(list[at])
    } else if (e.key === 'ArrowDown' && hist && el.selectionStart === text.length) {
      e.preventDefault()
      const at = hist.at + 1
      if (at >= hist.list.length) {
        setHist(null)
        setText('')
      } else {
        setHist({ ...hist, at })
        setText(hist.list[at])
      }
    }
    if (e.defaultPrevented) e.stopPropagation()
  }

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    const blob = item?.getAsFile()
    if (!blob) return
    e.preventDefault()
    try {
      const png = blob.type === 'image/png' ? blob : await toPng(blob)
      const file = await window.mc.savePastedImage(new Uint8Array(await png.arrayBuffer()))
      if (file) insert(pathForPrompt(file, agent.cwd, tool))
    } catch {
      /* not an image we can read */
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.mc.pathForFile(f)).filter(Boolean)
    if (paths.length) insert(paths.map((p) => pathForPrompt(p, agent.cwd, tool)).join(' '))
  }
  const quick = (q: (typeof QUICK)['claude'][number]) => {
    sendPrompt(write, q.cmd)
    if (q.menu) setTimeout(() => focusTerminal(agent.id), 300)
  }

  const working = st.cls === 'working'
  return (
    <div
      className={`composer ${dragging ? 'dragging' : ''} ${working ? 'is-working' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          spellCheck
          placeholder={working ? `${toolName(agent)} is working. Type to queue the next message…` : `Message ${toolName(agent)}…`}
          onChange={(e) => {
            setText(e.target.value)
            setHist(null)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button className="composer-send" onClick={send} disabled={!text.trim()} title="Send (Enter)">
          <CornerDownLeft size={14} />
        </button>
      </div>
      <div className="composer-foot">
        {QUICK[tool].map((q) => (
          <button key={q.cmd} className="composer-chip" onClick={() => quick(q)} title={`${q.cmd}: ${q.title}`} disabled={working && !q.menu && q.cmd !== '/context' && q.cmd !== '/status'}>
            {q.label}
          </button>
        ))}
        {working && (
          <button className="composer-chip stop" onClick={() => write('\x1b')} title="Interrupt (Esc)">
            <Square size={9} /> Stop
          </button>
        )}
        <span className="composer-hint">
          <ImagePlus size={11} /> paste or drop files · Enter send · Shift+Enter new line · ↑ history
        </span>
      </div>
    </div>
  )
}
