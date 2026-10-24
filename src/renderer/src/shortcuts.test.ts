import { describe, expect, it } from 'vitest'
import { SHORTCUTS, allowedIn, bindingIndex, comboFromEvent, conflictFor, effectiveKeys } from './shortcuts'

const ev = (key: string, code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  ({ key, code, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: false }) as KeyboardEvent

const el = (tag: string, inTerminal = false) =>
  ({ tagName: tag, isContentEditable: false, closest: (sel: string) => (inTerminal && sel === '.terminal-host' ? {} : null) }) as unknown as HTMLElement

describe('comboFromEvent', () => {
  it('names keys from their physical position, so Shift does not change them', () => {
    expect(comboFromEvent(ev('K', 'KeyK', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+K')
    expect(comboFromEvent(ev('!', 'Digit1', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+1')
    expect(comboFromEvent(ev('?', 'Slash', { ctrl: true }))).toBe('Ctrl+/')
    expect(comboFromEvent(ev('~', 'Backquote', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+`')
    expect(comboFromEvent(ev('ArrowUp', 'ArrowUp', { alt: true }))).toBe('Alt+Up')
    expect(comboFromEvent(ev('F5', 'F5'))).toBe('F5')
  })
  it('ignores a lone modifier', () => {
    expect(comboFromEvent(ev('Control', 'ControlLeft', { ctrl: true }))).toBe('')
  })
})

describe('allowedIn', () => {
  it('leaves plain Ctrl+letter to the terminal but takes Ctrl+Shift, Alt, Ctrl+digit and F keys', () => {
    const term = el('TEXTAREA', true)
    expect(allowedIn('Ctrl+K', term)).toBe(false)
    expect(allowedIn('Ctrl+B', term)).toBe(false)
    expect(allowedIn('Ctrl+Shift+K', term)).toBe(true)
    expect(allowedIn('Alt+1', term)).toBe(true)
    expect(allowedIn('Ctrl+2', term)).toBe(true)
    expect(allowedIn('Ctrl+Tab', term)).toBe(true)
    expect(allowedIn('F1', term)).toBe(true)
  })
  it('lets text fields keep typing and editing keys', () => {
    const input = el('INPUT')
    expect(allowedIn('F2', input)).toBe(false)
    expect(allowedIn('Ctrl+A', input)).toBe(false)
    expect(allowedIn('Ctrl+Enter', input)).toBe(false)
    expect(allowedIn('Ctrl+K', input)).toBe(true)
    expect(allowedIn('Alt+O', input)).toBe(true)
  })
  it('allows everything elsewhere', () => {
    expect(allowedIn('F2', el('DIV'))).toBe(true)
  })
})

describe('bindings', () => {
  it('has no default combination used twice', () => {
    const seen = new Map<string, string>()
    for (const s of SHORTCUTS) for (const k of s.keys) {
      expect(seen.get(k), `${k} is used by ${seen.get(k)} and ${s.id}`).toBeUndefined()
      seen.set(k, s.id)
    }
  })
  it('applies your own bindings and unbinding', () => {
    const keys = effectiveKeys({ newTask: 'Ctrl+Alt+N', palette: '' })
    expect(keys.get('newTask')).toEqual(['Ctrl+Alt+N'])
    expect(keys.get('palette')).toEqual([])
    const idx = bindingIndex(keys)
    expect(idx.get('Ctrl+Alt+N')).toBe('newTask')
    expect(idx.has('Ctrl+K')).toBe(false)
  })
  it('finds the shortcut a new combination would take over', () => {
    const keys = effectiveKeys({})
    expect(conflictFor(keys, 'newTask', 'Ctrl+K')?.id).toBe('palette')
    expect(conflictFor(keys, 'palette', 'Ctrl+K')).toBeUndefined()
  })
})
