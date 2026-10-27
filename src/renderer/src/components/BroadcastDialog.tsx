import { useState } from 'react'
import { Send, X } from 'lucide-react'
import { promptInput } from '@shared/terminalInput'
import { briefingFileName, writeBriefingPrompt } from '@shared/projectLook'
import type { Agent } from '../types'
import { displayStatus } from '../agentStatus'
import { useToast } from '../toast'
import { Avatar, Button, IconButton, ToolBadge } from './ui'

interface Props {
  /** Live Claude and Codex agents. */
  agents: Agent[]
  lastOutput: Record<string, number>
  onClose: () => void
}

/** Ready-made prompts; "briefing" writes each agent's own file name into its prompt. */
const PRESETS: { label: string; text: string; hint: string }[] = [
  { label: 'Write a briefing', text: '{{briefing}}', hint: 'Each agent writes a handoff to its docs/briefings/' },
  { label: 'Where are you?', text: 'In 3 short lines: what you are doing, what is done, and what is next. Do not start anything new.', hint: 'A quick status from each' },
  { label: 'Wrap up', text: 'Finish the step you are on, commit your work with a clear message if this is a git repository, then tell me what is left.', hint: 'Before you stop for the day' },
  { label: '/compact', text: '/compact', hint: 'Shrink each chat' }
]

/** Types one prompt into several agents at once (Ctrl+Shift+A). */
export default function BroadcastDialog({ agents, lastOutput, onClose }: Props) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(agents.map((a) => a.id)))
  const [submit, setSubmit] = useState(true)

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const send = () => {
    const targets = agents.filter((a) => picked.has(a.id))
    let sent = 0
    for (const a of targets) {
      const prompt = text.trim() === '{{briefing}}' ? writeBriefingPrompt(`docs/briefings/${briefingFileName(Date.now(), a.title)}`) : text
      const input = promptInput(prompt, submit)
      if (!input) continue
      window.mc.ptyWrite(a.id, input)
      sent++
    }
    if (!sent) return
    toast('success', `Sent to ${sent} ${sent === 1 ? 'agent' : 'agents'}`, submit ? 'Agents that were busy take it when they finish.' : 'Typed in, not sent: press Enter in each agent to send.')
    onClose()
  }

  const busy = agents.filter((a) => picked.has(a.id) && displayStatus(a, lastOutput[a.id]).cls === 'working').length
  const isBriefing = text.trim() === '{{briefing}}'

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog broadcast" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="dialog-head">
          <h2>
            <Send size={16} /> Send to several agents
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">
          <div className="broadcast-presets">
            {PRESETS.map((p) => (
              <button key={p.label} className={`chip ${text === p.text ? 'chip-accent' : ''}`} title={p.hint} onClick={() => setText(p.text)}>
                {p.label}
              </button>
            ))}
          </div>
          {isBriefing ? (
            <p className="broadcast-note">
              Each agent is asked to write a session briefing to its own <span className="mono">docs/briefings/</span> file, named after its tab.{' '}
              <button className="link-btn" onClick={() => setText('')}>
                Write my own prompt
              </button>
            </p>
          ) : (
            <textarea
              className="text-input broadcast-text"
              autoFocus
              rows={5}
              placeholder="What should every agent you pick do? Line breaks are kept: it arrives as one message."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
          )}
          <div className="broadcast-head">
            <span className="field-label">
              Agents ({picked.size} of {agents.length})
            </span>
            <button className="link-btn small" onClick={() => setPicked(picked.size === agents.length ? new Set() : new Set(agents.map((a) => a.id)))}>
              {picked.size === agents.length ? 'None' : 'All'}
            </button>
          </div>
          <ul className="broadcast-agents">
            {agents.map((a) => {
              const st = displayStatus(a, lastOutput[a.id])
              return (
                <li key={a.id}>
                  <label className="check-row">
                    <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                    {a.kind !== 'shell' && <ToolBadge tool={a.kind} />}<Avatar name={a.projectName} path={a.projectPath} size={18} />
                    <span className="ellipsis">{a.title}</span>
                    <span className={`status-pill status-${st.cls}`}>
                      <span className={`dot ${st.cls}`} />
                      <span className="ellipsis">{st.label}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <label className="check-row">
            <input type="checkbox" checked={submit} onChange={(e) => setSubmit(e.target.checked)} />
            <span>
              Send it (press Enter in each agent)
              <span className="field-hint block">Off: it's only typed in, so you can check or change it per agent first.</span>
            </span>
          </label>
          {submit && busy > 0 && <p className="field-hint">{busy} of them {busy === 1 ? 'is' : 'are'} working; Claude takes the message when it finishes.</p>}
        </div>
        <div className="dialog-foot">
          <span className="muted small">Ctrl+Enter sends</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Send} disabled={!picked.size || !text.trim()} onClick={send}>
            Send to {picked.size} {picked.size === 1 ? 'agent' : 'agents'}
          </Button>
        </div>
      </div>
    </div>
  )
}
