import { describe, expect, it } from 'vitest'
import { fillVariables, nextRunAfter } from './schedule'
import type { Schedule } from './types'

const at = (iso: string) => new Date(iso).getTime()
const s = (patch: Partial<Schedule>): Schedule => ({ enabled: true, kind: 'daily', time: '09:00', then: 'todo', ...patch })
// Friday 23 Oct 2026, 10:00 local time.
const FRI_10 = at('2026-10-23T10:00:00')

describe('nextRunAfter', () => {
  it('daily: later today if the time is still ahead', () => {
    expect(nextRunAfter(s({ time: '18:30' }), FRI_10)).toBe(at('2026-10-23T18:30:00'))
  })
  it('daily: tomorrow if the time has passed', () => {
    expect(nextRunAfter(s({ time: '09:00' }), FRI_10)).toBe(at('2026-10-24T09:00:00'))
  })
  it('daily: exactly now counts as passed', () => {
    expect(nextRunAfter(s({ time: '10:00' }), FRI_10)).toBe(at('2026-10-24T10:00:00'))
  })
  it('weekdays: skips the weekend', () => {
    expect(nextRunAfter(s({ kind: 'weekdays', time: '09:00' }), FRI_10)).toBe(at('2026-10-26T09:00:00'))
  })
  it('weekdays: same day if still ahead', () => {
    expect(nextRunAfter(s({ kind: 'weekdays', time: '17:00' }), FRI_10)).toBe(at('2026-10-23T17:00:00'))
  })
  it('weekly: next matching weekday', () => {
    expect(nextRunAfter(s({ kind: 'weekly', weekday: 3, time: '08:15' }), FRI_10)).toBe(at('2026-10-28T08:15:00'))
  })
  it('weekly: a week later when today already passed', () => {
    expect(nextRunAfter(s({ kind: 'weekly', weekday: 5, time: '09:00' }), FRI_10)).toBe(at('2026-10-30T09:00:00'))
  })
  it('hourly: adds the interval, clamped to 1..168', () => {
    expect(nextRunAfter(s({ kind: 'hourly', everyHours: 6 }), FRI_10)).toBe(FRI_10 + 6 * 3_600_000)
    expect(nextRunAfter(s({ kind: 'hourly', everyHours: 0 }), FRI_10)).toBe(FRI_10 + 3_600_000)
    expect(nextRunAfter(s({ kind: 'hourly', everyHours: 9999 }), FRI_10)).toBe(FRI_10 + 168 * 3_600_000)
  })
  it('falls back to 09:00 for a malformed time', () => {
    expect(nextRunAfter(s({ time: 'soon' }), FRI_10)).toBe(at('2026-10-24T09:00:00'))
  })
})

describe('fillVariables', () => {
  const now = new Date(FRI_10)
  it('fills known variables, case-insensitively and with spaces', () => {
    expect(fillVariables('{{project}} {{ DATE }}', 'bot', now)).toBe('bot 2026-10-23')
  })
  it('leaves unknown variables as written', () => {
    expect(fillVariables('{{nope}} and {{project}}', 'bot', now)).toBe('{{nope}} and bot')
  })
  it('fills the weekday name', () => {
    expect(fillVariables('{{weekday}}', 'bot', now)).toMatch(/^Fri/)
  })
})
