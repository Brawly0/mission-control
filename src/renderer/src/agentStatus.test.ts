import { describe, expect, it } from 'vitest'
import { activityFromHook, statusFromHook } from './agentStatus'
import type { HookEvent } from '@shared/types'

const ev = (event: string, extra: Partial<HookEvent> = {}): HookEvent => ({ agentId: 'a', event, at: 100, ...extra })

describe('activityFromHook', () => {
  it('shows the tool before it runs and clears it after', () => {
    const tool = { verb: 'Running', target: 'npm test' }
    const before = activityFromHook(ev('PreToolUse', { tool }), {})
    expect(before.activity).toEqual({ ...tool, at: 100 })
    expect(activityFromHook(ev('PostToolUse', { tool }), before).activity).toBeUndefined()
  })

  it('keeps one entry per edited file, newest last', () => {
    const edit = (file: string) => ev('PostToolUse', { tool: { verb: 'Editing', target: file, file } })
    let s = activityFromHook(edit('C:\\r\\a.ts'), {})
    s = activityFromHook(edit('C:\\r\\b.ts'), s)
    s = activityFromHook(edit('c:\\r\\A.ts'), s)
    expect(s.edited).toEqual(['C:\\r\\b.ts', 'c:\\r\\A.ts'])
  })

  it('clears the tool when the turn ends and ignores other events', () => {
    const busy = { activity: { verb: 'Reading', target: 'x', at: 1 }, edited: ['f'] }
    expect(activityFromHook(ev('Stop'), busy)).toEqual({ activity: undefined, edited: ['f'] })
    expect(activityFromHook(ev('Notification'), busy)).toBe(busy)
  })
})

describe('statusFromHook', () => {
  it('counts PreToolUse as working', () => {
    expect(statusFromHook(ev('PreToolUse'), 'done')?.status).toBe('working')
  })
})
