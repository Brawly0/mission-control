import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/types'
import { inboxCount, inboxItems, visibleInbox, type InboxInput } from './inbox'
import type { Agent } from './types'

const NOW = new Date(2026, 9, 24, 15, 0).getTime()

const agent = (patch: Partial<Agent>): Agent => ({
  id: 'a1',
  title: 'App · new',
  cwd: 'C:\\app',
  projectName: 'App',
  projectPath: 'C:\\app',
  kind: 'claude',
  exited: false,
  startedAt: NOW - 3_600_000,
  ...patch
})

const task = (patch: Partial<Task>): Task => ({
  id: 't1',
  title: 'Fix login',
  prompt: '',
  projectPath: 'C:\\app',
  projectName: 'App',
  column: 'todo',
  mode: 'headless',
  permission: 'acceptEdits',
  useWorktree: false,
  createdAt: 0,
  updatedAt: 0,
  order: 0,
  ...patch
})

const input = (patch: Partial<InboxInput>): InboxInput => ({
  now: NOW,
  agents: [],
  tasks: [],
  rateLimit: null,
  planAlertPercent: 80,
  budgets: {},
  projects: [],
  update: { state: 'idle' },
  queue: null,
  restoreCount: 0,
  ...patch
})

describe('inboxItems', () => {
  it('puts agents waiting for permission first, and they cannot be dismissed', () => {
    const items = inboxItems(
      input({
        agents: [agent({ id: 'a1', hookStatus: 'done', statusAt: NOW - 60_000 }), agent({ id: 'a2', hookStatus: 'needs-input', statusMessage: 'Claude needs your permission to use Bash' })]
      })
    )
    expect(items.map((i) => i.key)).toEqual(['agent:a2:input', `agent:a1:done:${NOW - 60_000}`])
    expect(items[0]).toMatchObject({ severity: 'urgent', dismissable: false, detail: 'Claude needs your permission to use Bash' })
  })
  it('lists finished tasks for review, failures as urgent', () => {
    const ok = task({ id: 'ok', column: 'review', run: { startedAt: 0, finishedAt: NOW - 10, toolCalls: 1, events: [] } })
    const bad = task({ id: 'bad', column: 'review', run: { startedAt: 0, finishedAt: NOW - 20, toolCalls: 1, events: [], error: 'Budget reached' } })
    const items = inboxItems(input({ tasks: [ok, bad] }))
    expect(items.map((i) => [i.key, i.severity, i.kind])).toEqual([
      [`task:bad:${NOW - 20}`, 'urgent', 'failed'],
      [`task:ok:${NOW - 10}`, 'normal', 'review']
    ])
    expect(items[1].secondary?.action).toBe('taskDone')
  })
  it('flags overdue tasks and ones due later today, not tomorrow', () => {
    const items = inboxItems(
      input({
        tasks: [task({ id: 'late', dueAt: NOW - 3_600_000 }), task({ id: 'today', dueAt: NOW + 3_600_000 }), task({ id: 'tomorrow', dueAt: NOW + 86_400_000 }), task({ id: 'done', column: 'done', dueAt: NOW - 1 })]
      })
    )
    expect(items.map((i) => [i.key.split(':')[1], i.severity])).toEqual([
      ['late', 'urgent'],
      ['today', 'normal']
    ])
  })
  it('warns about plan limits at the alert level, when out, and when the pace runs out soon', () => {
    const resetsAt = NOW + 2 * 3_600_000
    const items = inboxItems(
      input({
        rateLimit: {
          at: NOW,
          status: 'allowed',
          windows: [
            { name: 'five_hour', utilization: 0.5, resetsAt, forecast: { ratePerHour: 0.5, atReset: 1.5, runsOutAt: NOW + 1_800_000, basis: 'recent' } },
            { name: 'seven_day', utilization: 0.85, resetsAt: NOW + 3 * 86_400_000 }
          ]
        }
      })
    )
    expect(items.map((i) => i.key)).toEqual([`limit:five_hour@${Math.round(resetsAt / 60_000)}:pace`, `limit:seven_day@${Math.round((NOW + 3 * 86_400_000) / 60_000)}:near`])
  })
  it('includes budgets, a held queue, a ready update and agents to restore', () => {
    const items = inboxItems(
      input({
        budgets: { 'c:\\app': { budget: 50, spent: 60, ratio: 1.2, over: true } },
        projects: [{ path: 'C:\\app', name: 'App' } as never],
        queue: { enabled: true, parallel: 1, queued: 2, running: 0, heldBecause: 'Plan usage is at 96%' },
        update: { state: 'ready', version: '0.16.0' },
        restoreCount: 2
      })
    )
    expect(items.map((i) => i.kind)).toEqual(['budget', 'queue', 'update', 'restore'])
    expect(items[0].title).toBe('App is over its monthly budget')
    expect(inboxCount(items)).toEqual({ total: 2, urgent: 1 })
  })
})

describe('visibleInbox', () => {
  it('hides dismissed items but never live ones', () => {
    const items = inboxItems(input({ agents: [agent({ id: 'x', hookStatus: 'needs-input' })], update: { state: 'ready', version: '1' } }))
    expect(visibleInbox(items, ['agent:x:input', 'update:1']).map((i) => i.key)).toEqual(['agent:x:input'])
  })
})
