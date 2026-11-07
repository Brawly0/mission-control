import { describe, expect, it } from 'vitest'
import { Fragment, isValidElement } from 'react'
import { brandParts, brandProps } from './brandText'

describe('brandParts', () => {
  it('swaps whole words for logos', () => {
    expect(brandParts('Chat with Claude')).toEqual(['Chat with ', { logo: 'Claude' }])
    expect(brandParts('Claude and Codex.')).toEqual([{ logo: 'Claude' }, ' and ', { logo: 'Codex' }, '.'])
    expect(brandParts("Claude's plan")).toEqual([{ logo: 'Claude' }, "'s plan"])
  })

  it('leaves names, paths and identifiers alone', () => {
    for (const s of ['claude-hub', 'CLAUDE.md', 'Claude.md', '~/.Claude/x', '@Claude', 'ClaudeCode', 'codex exec', 'Claude-hub']) expect(brandParts(s)).toEqual([s])
  })
})

describe('brandProps', () => {
  it('wraps matching text children of DOM elements and fragments', () => {
    const one = brandProps('span', { children: 'Start Claude' })
    expect(isValidElement(one?.children)).toBe(true)
    const many = brandProps(Fragment, { children: ['Send to ', ['Codex', 1]] })
    const inner = (many?.children as unknown[])[1] as unknown[]
    expect((many?.children as unknown[])[0]).toBe('Send to ')
    expect(isValidElement(inner[0])).toBe(true)
    expect(inner[1]).toBe(1)
  })

  it('returns the same props when nothing matches or the element opts out', () => {
    for (const [type, props] of [
      ['span', { children: 'Projects' }],
      ['textarea', { children: 'Claude' }],
      ['code', { children: 'Claude' }],
      ['div', { children: 'Claude', 'data-no-brand': true }],
      [() => null, { children: 'Claude' }]
    ] as const) expect(brandProps(type, props)).toBe(props)
  })
})
