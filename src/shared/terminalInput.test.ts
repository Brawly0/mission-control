import { describe, expect, it, vi } from 'vitest'
import { promptInput, sendPrompt, SUBMIT_DELAY_MS } from './terminalInput'

describe('promptInput', () => {
  it('types one-line prompts and presses Enter', () => {
    expect(promptInput('  /compact ')).toBe('/compact\r')
    expect(promptInput('hello', false)).toBe('hello')
  })
  it('pastes multi-line prompts as one message', () => {
    expect(promptInput('line one\r\nline two')).toBe('\x1b[200~line one\rline two\x1b[201~\r')
  })
  it('sends nothing for an empty prompt', () => {
    expect(promptInput('   ')).toBe('')
  })
})

describe('sendPrompt', () => {
  it('types the prompt, then presses Enter as a separate keystroke after a pause', () => {
    vi.useFakeTimers()
    const writes: string[] = []
    expect(sendPrompt((d) => writes.push(d), 'Write a briefing')).toBe(true)
    expect(writes).toEqual(['Write a briefing'])
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(writes).toEqual(['Write a briefing', '\r'])
    vi.useRealTimers()
  })
  it('leaves the prompt unsent when asked, and sends nothing for an empty one', () => {
    vi.useFakeTimers()
    const writes: string[] = []
    sendPrompt((d) => writes.push(d), 'draft', false)
    expect(sendPrompt((d) => writes.push(d), '  ')).toBe(false)
    vi.runAllTimers()
    expect(writes).toEqual(['draft'])
    vi.useRealTimers()
  })
})
