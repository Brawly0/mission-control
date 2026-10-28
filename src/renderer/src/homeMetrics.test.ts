import { describe, expect, it } from 'vitest'
import type { DashboardDay } from '@shared/types'
import { activityPeriod, calendarDay, comparisonLabel, dayKey, durationPresentation, timeLabel, weekStart } from './homeMetrics'

const day = (date: string, tool: 'claude' | 'codex', minutes: number, events = 2): DashboardDay => ({ day: date, tool, activeMinutes: minutes, events, sessions: 1 })

describe('Home activity periods', () => {
  it('starts calendar weeks on Monday, including across year boundaries', () => {
    expect(dayKey(weekStart(new Date(2027, 0, 3)))).toBe('2026-12-28')
    expect(dayKey(weekStart(new Date(2027, 0, 4)))).toBe('2027-01-04')
    expect(dayKey(calendarDay(new Date(2026, 2, 8, 23), 1))).toBe('2026-03-09')
  })
  it('excludes prior weeks and future days and sums both providers consistently', () => {
    const data = [day('2026-10-25', 'claude', 90), day('2026-10-26', 'claude', 12.5), day('2026-10-28', 'codex', 8), day('2026-10-29', 'codex', 100)]
    const result = activityPeriod(data, 'week', new Date(2026, 9, 28))
    expect(result.minutes).toBe(20.5)
    expect(result.providers.claude.minutes + result.providers.codex.minutes).toBe(result.minutes)
    expect(result.events).toBe(4)
    expect(result.days).toHaveLength(2)
  })
  it('uses calendar months at leap-day and year boundaries', () => {
    const data = [day('2024-02-29', 'claude', 5), day('2024-03-01', 'codex', 10)]
    expect(activityPeriod(data, 'month', new Date(2024, 2, 1)).minutes).toBe(10)
    expect(activityPeriod(data, 'month', new Date(2024, 1, 29)).minutes).toBe(5)
    expect(dayKey(activityPeriod([], 'month', new Date(2027, 0, 1)).start)).toBe('2027-01-01')
  })
  it('keeps historical-only data out of this week but available in all history', () => {
    const data = [day('2026-09-01', 'claude', 120)]
    expect(activityPeriod(data, 'week', new Date(2026, 9, 28)).minutes).toBe(0)
    const all = activityPeriod(data, 'all', new Date(2026, 9, 28))
    expect(all.minutes).toBe(120)
    expect(dayKey(all.start)).toBe('2026-09-01')
    expect(all.label).toContain('All indexed history')
  })
  it('handles unsorted history and an inactive provider without inventing minutes', () => {
    const result = activityPeriod([day('2026-10-28', 'claude', 10), day('2026-01-01', 'claude', 5)], 'all', new Date(2026, 9, 28))
    expect(dayKey(result.start)).toBe('2026-01-01')
    expect(result.providers.codex).toEqual({ minutes: 0, events: 0 })
    expect(result.minutes).toBe(15)
  })
})

describe('Home duration presentation', () => {
  it('distinguishes an empty period from events without measurable duration', () => {
    expect(durationPresentation(0, 0)).toEqual({ value: '—', note: 'No activity in this period' })
    expect(durationPresentation(0, 3)).toEqual({ value: '0m', note: '3 activity events; no measurable duration' })
    expect(durationPresentation(0.1, 2).value).toBe('<1m')
    expect(timeLabel(75)).toBe('1h 15m')
  })
  it('shows comparisons only when both periods have measurable activity', () => {
    expect(comparisonLabel(0, 60)).toBeNull()
    expect(comparisonLabel(20, 0)).toBeNull()
    expect(comparisonLabel(0, 0)).toBeNull()
    expect(comparisonLabel(30, 60)).toBe('-50% vs last week · est.')
    expect(comparisonLabel(60, 30)).toBe('+100% vs last week · est.')
  })
})
