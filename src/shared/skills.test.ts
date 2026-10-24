import { describe, expect, it } from 'vitest'
import { coachLevel, coachMessage, skillUsesIn } from './skills'

describe('skillUsesIn', () => {
  it('finds Claude calling the Skill tool (as recorded in real transcripts)', () => {
    const e = {
      type: 'assistant',
      uuid: 'u1',
      message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: 'superpowers:systematic-debugging' } }, { type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }] }
    }
    expect(skillUsesIn(e)).toEqual([{ id: 'toolu_1', skill: 'superpowers:systematic-debugging', how: 'claude' }])
  })
  it('finds you typing /name, but not built-in commands', () => {
    const typed = (name: string, asBlocks = false) => {
      const text = `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>`
      return { type: 'user', uuid: `u-${name}`, message: { content: asBlocks ? [{ type: 'text', text }] : text } }
    }
    expect(skillUsesIn(typed('graphify'))).toEqual([{ id: 'u-graphify', skill: 'graphify', how: 'you' }])
    expect(skillUsesIn(typed('eco:coach', true))).toEqual([{ id: 'u-eco:coach', skill: 'eco:coach', how: 'you' }])
    expect(skillUsesIn(typed('compact'))).toEqual([])
    expect(skillUsesIn(typed('model'))).toEqual([])
  })
  it('ignores everything else', () => {
    expect(skillUsesIn({ type: 'user', message: { content: 'just text' } })).toEqual([])
    expect(skillUsesIn({ type: 'system' })).toEqual([])
    expect(skillUsesIn(null)).toEqual([])
  })
})

describe('coach', () => {
  it('levels at 60% and 85% of the window', () => {
    expect(coachLevel(80_000, 150_000)).toBe(0)
    expect(coachLevel(95_000, 150_000)).toBe(1)
    expect(coachLevel(130_000, 150_000)).toBe(2)
    expect(coachLevel(500_000, 0)).toBe(0)
  })
  it('says nothing when there is nothing to say', () => {
    expect(coachMessage(0, 10_000, 150_000)).toBeNull()
  })
  it('names the size, the window and the plan note', () => {
    expect(coachMessage(1, 95_000, 150_000)).toContain('about 95k tokens')
    const msg = coachMessage(2, 130_000, 150_000, "The user's 5-hour limit is at 91%.")!
    expect(msg).toContain('auto-compaction at 150k')
    expect(msg).toContain('5-hour limit is at 91%')
    expect(coachMessage(0, 1, 150_000, 'Plan note.')).toContain('Plan note.')
    expect(coachMessage(2, 944_000, 150_000)).toContain('about 944k tokens, far past the point where compacting pays off')
  })
})
