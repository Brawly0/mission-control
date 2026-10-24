import { useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Search, X } from 'lucide-react'
import { SHORTCUTS, comboFromEvent, conflictFor, effectiveKeys, type ShortcutGroup } from '../shortcuts'
import { Button, IconButton, Kbd } from './ui'

const GROUPS: ShortcutGroup[] = ['General', 'Go to', 'Project', 'Chats', 'Agents', 'Tasks', 'View']

/** Shows a combination as key caps: "Ctrl+Shift+K" -> [Ctrl] [Shift] [K]. */
export function KeyCombo({ combo }: { combo: string }) {
  return (
    <span className="key-combo">
      {combo.split('+').map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  )
}

/**
 * Every shortcut, searchable, grouped. Click a shortcut's keys to record a new combination;
 * your own bindings are saved in Settings (keybindings) and win over the defaults.
 */
export default function ShortcutsDialog({
  overrides,
  onChange,
  onClose
}: {
  overrides: Record<string, string>
  onChange: (next: Record<string, string>) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [pending, setPending] = useState<{ id: string; combo: string } | null>(null)
  const keys = useMemo(() => effectiveKeys(overrides), [overrides])

  const q = query.trim().toLowerCase()
  const matches = SHORTCUTS.filter((s) => !q || s.label.toLowerCase().includes(q) || s.group.toLowerCase().includes(q) || (keys.get(s.id) ?? []).some((k) => k.toLowerCase().includes(q)))
  const conflict = pending ? conflictFor(keys, pending.id, pending.combo) : undefined

  const save = (id: string, combo: string) => {
    const def = SHORTCUTS.find((s) => s.id === id)!
    const next = { ...overrides }
    // Back to the default combination means "no override".
    if (def.keys[0] === combo && def.keys.length === 1) delete next[id]
    else next[id] = combo
    if (conflict) {
      // The other shortcut gives up this combination.
      const theirs = (keys.get(conflict.id) ?? []).filter((k) => k !== combo)
      next[conflict.id] = theirs[0] ?? ''
    }
    onChange(next)
    setPending(null)
    setRecording(null)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog shortcuts-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (recording) {
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'Escape') {
              setRecording(null)
              setPending(null)
              return
            }
            const combo = comboFromEvent(e.nativeEvent)
            if (combo) setPending({ id: recording, combo })
            return
          }
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="dialog-head">
          <h2>
            <Keyboard size={16} /> Keyboard shortcuts
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="shortcuts-search">
          <Search size={14} />
          <input autoFocus placeholder="Search shortcuts or keys" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="dialog-body shortcuts-body">
          <p className="muted small">
            Inside a terminal, plain Ctrl+letter keys go to Claude and the shell. There, only shortcuts with Alt, Ctrl+Shift, Ctrl+number or an F key work. Click a shortcut’s keys to change it.
          </p>
          {GROUPS.map((g) => {
            const rows = matches.filter((s) => s.group === g)
            if (!rows.length) return null
            return (
              <section key={g} className="shortcut-group">
                <h3>{g}</h3>
                {rows.map((s) => {
                  const combos = keys.get(s.id) ?? []
                  const isRecording = recording === s.id
                  const changed = overrides[s.id] !== undefined
                  return (
                    <div key={s.id} className={`shortcut-row ${isRecording ? 'recording' : ''}`}>
                      <span className="shortcut-label">{s.label}</span>
                      {isRecording ? (
                        <span className="shortcut-record">
                          {pending ? <KeyCombo combo={pending.combo} /> : <span className="muted small">Press keys… (Esc cancels)</span>}
                          {pending && (
                            <>
                              {conflict && <span className="warn-text small">Replaces “{conflict.label}”</span>}
                              <Button size="sm" variant="primary" onClick={() => save(s.id, pending.combo)}>
                                Save
                              </Button>
                            </>
                          )}
                        </span>
                      ) : (
                        <button className="shortcut-keys" title="Change" onClick={() => setRecording(s.id)}>
                          {combos.length ? combos.map((c) => <KeyCombo key={c} combo={c} />) : <span className="muted small">Not set</span>}
                        </button>
                      )}
                      {changed && !isRecording && (
                        <IconButton
                          icon={RotateCcw}
                          label="Back to default"
                          size={13}
                          onClick={() => {
                            const next = { ...overrides }
                            delete next[s.id]
                            onChange(next)
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </section>
            )
          })}
          {!matches.length && <div className="muted pad">No shortcuts match.</div>}
        </div>
        <div className="dialog-foot">
          <span className="muted small">
            Open this list anytime with <KeyCombo combo={keys.get('shortcuts')?.[0] ?? 'Ctrl+/'} />
          </span>
          {Object.keys(overrides).length > 0 && (
            <Button variant="ghost" icon={RotateCcw} onClick={() => onChange({})}>
              Reset all
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
