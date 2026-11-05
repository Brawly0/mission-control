import { describe, expect, it } from 'vitest'
import { vibeTime, type VibeEvent } from './vibeTime'

const at = (day: number, hour = 12, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime()
// Thursday 2026-11-05 18:00 local.
const now = at(5, 18)
const ev = (session: string, ts: number, tool: VibeEvent['tool'] = 'claude'): VibeEvent => ({ session, tool, ts })

describe('vibeTime', () => {
  it('is all zeros for no events', () => {
    expect(vibeTime([], now)).toEqual({
      minutes: 0, claudeMinutes: 0, codexMinutes: 0, parallelMinutes: 0, todayMinutes: 0, weekMinutes: 0, lastWeekMinutes: 0,
      activeDays: 0, longestDay: null, longestStreak: null, currentStreak: 0, busiestHour: null, firstAt: 0
    })
  })

  it('counts gaps up to 15 minutes within a chat and skips longer breaks', () => {
    const t = vibeTime([ev('a', at(5, 10)), ev('a', at(5, 10, 15)), ev('a', at(5, 10, 30, 1)), ev('a', at(5, 10, 40, 1))], now)
    expect(t.minutes).toBe(25)
    expect(t.todayMinutes).toBe(25)
  })

  it('counts overlapping chats once and reports the overlap as parallel time', () => {
    const t = vibeTime([ev('a', at(5, 10)), ev('a', at(5, 10, 10)), ev('b', at(5, 10, 5), 'codex'), ev('b', at(5, 10, 15), 'codex')], now)
    expect(t.minutes).toBe(15)
    expect(t.claudeMinutes).toBe(10)
    expect(t.codexMinutes).toBe(10)
    expect(t.parallelMinutes).toBe(5)
  })

  it('never links messages from different chats', () => {
    const t = vibeTime([ev('a', at(5, 10)), ev('b', at(5, 10, 5))], now)
    expect(t.minutes).toBe(0)
    expect(t.activeDays).toBe(1)
  })

  it('ignores duplicate timestamps, future and invalid events', () => {
    const t = vibeTime([ev('a', at(5, 10)), ev('a', at(5, 10)), ev('a', at(5, 10, 5)), ev('a', now + 1), ev('a', 0), ev('a', NaN)], now)
    expect(t.minutes).toBe(5)
    expect(t.firstAt).toBe(at(5, 10))
  })

  it('splits a span over midnight between the two days', () => {
    const t = vibeTime([ev('a', at(3, 23, 50)), ev('a', at(4, 0, 4))], now)
    expect(t.minutes).toBe(14)
    expect(t.longestDay).toEqual({ day: '2026-11-03', minutes: 10 })
  })

  it('finds the busiest hour, this week, streaks and the current streak', () => {
    // Last week: Fri 30 Oct and Sat 31 Oct (Monday this week is 2 Nov).
    const oct = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()
    const events = [ev('a', oct(30, 9)), ev('a', oct(30, 9, 10)), ev('b', oct(31, 9))]
    // This week: Tue 3, Wed 4, Thu 5 Nov.
    events.push(ev('c', at(3, 21)), ev('c', at(3, 21, 12)), ev('d', at(4, 21)), ev('d', at(4, 21, 6)), ev('e', at(5, 9)))
    const t = vibeTime(events, now)
    expect(t.minutes).toBe(28)
    expect(t.weekMinutes).toBe(18)
    expect(t.lastWeekMinutes).toBe(10)
    expect(t.busiestHour).toEqual({ hour: 21, minutes: 18 })
    expect(t.activeDays).toBe(5)
    expect(t.longestStreak).toEqual({ days: 3, from: '2026-11-03', to: '2026-11-05' })
    expect(t.currentStreak).toBe(3)
  })

  it('keeps a streak that ended yesterday but drops one that ended earlier', () => {
    expect(vibeTime([ev('a', at(4, 10))], now).currentStreak).toBe(1)
    expect(vibeTime([ev('a', at(3, 10))], now).currentStreak).toBe(0)
  })
})
