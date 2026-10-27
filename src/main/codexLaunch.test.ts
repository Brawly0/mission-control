import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexLaunchArgs } from './codexLaunch'

const root = join(tmpdir(), 'mission-control-quick-chats')

describe('Codex quick chat launch', () => {
  it('uses low reasoning for a new quick chat', () => {
    expect(codexLaunchArgs(join(root, '2026-10-28-12-00'), [])).toEqual(['-c', 'model_reasoning_effort="low"'])
  })

  it('keeps resume arguments and prompts intact without mutating them', () => {
    for (const args of [['resume', 'session-id'], ['Explain this briefly']]) {
      const original = [...args]
      expect(codexLaunchArgs(join(root, 'chat'), args)).toEqual(['-c', 'model_reasoning_effort="low"', ...original])
      expect(args).toEqual(original)
    }
  })

  it('leaves project chats and similarly named sibling folders alone', () => {
    for (const cwd of [root, join(tmpdir(), 'project'), `${root}-project`, join(root, '..', 'project')]) {
      const args = ['resume', 'session-id']
      expect(codexLaunchArgs(cwd, args)).toBe(args)
    }
  })
})
