import { describe, expect, it } from 'vitest'
import { dayKey, digestDue, digestEmpty, digestText, startOfDay } from './digest'
import type { Digest } from './types'

const at = (h: number, m = 0) => new Date(2026, 9, 24, h, m).getTime()

const base: Digest = {
  day: '2026-10-23',
  label: 'yesterday',
  from: 0,
  to: 0,
  chats: 0,
  replies: 0,
  costUsd: 0,
  topProjects: [],
  topChats: [],
  tasksFinished: 0,
  tasksFailed: 0,
  briefings: 0,
  review: 0,
  dueToday: [],
  overdue: 0,
  generatedAt: 0
}

describe('digestDue', () => {
  it('fires once the time has passed, once a day', () => {
    expect(digestDue(at(8, 59), '09:00', '')).toBe(false)
    expect(digestDue(at(9), '09:00', '')).toBe(true)
    expect(digestDue(at(15), '09:00', '2026-10-23')).toBe(true)
    expect(digestDue(at(15), '09:00', '2026-10-24')).toBe(false)
  })
  it('is off without a valid time', () => {
    expect(digestDue(at(15), '', '')).toBe(false)
    expect(digestDue(at(15), 'soon', '')).toBe(false)
  })
})

describe('days', () => {
  it('finds local midnights and day keys', () => {
    expect(dayKey(at(23, 59))).toBe('2026-10-24')
    expect(startOfDay(at(15), -1)).toBe(new Date(2026, 9, 23).getTime())
  })
})

describe('digestText', () => {
  it('sums up the day and what is waiting now', () => {
    const d: Digest = { ...base, chats: 12, weekShare: 0.043, tasksFinished: 3, tasksFailed: 1, briefings: 2, review: 2, overdue: 1, dueToday: [{ id: 'a', title: 'x', dueAt: 0 }], week: { utilization: 0.41, resetsAt: 0, pace: '' } }
    expect(digestText(d).body).toBe('Yesterday: 12 chats, ≈4.3% of your week · 3 tasks finished (1 with problems) · 2 briefings. Now: 2 to review · 1 overdue · 1 due today · week at 41%.')
  })
  it('says when nothing happened', () => {
    expect(digestText(base).body).toBe('Yesterday: no chats.')
    expect(digestEmpty(base)).toBe(true)
    expect(digestEmpty({ ...base, review: 1 })).toBe(false)
  })
})
