import { describe, expect, it } from 'vitest'
import { promptInput } from './terminalInput'

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
