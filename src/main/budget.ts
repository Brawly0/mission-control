import type { BudgetState, UsageReport } from '../shared/types'
import { normalizePath } from './claudeData'
import { queryIndex } from './indexer'
import { loadStore, updateStore } from './store'

/**
 * Monthly spending guardrails per project. Spend comes from the chat index (estimated at API
 * prices), so it covers interactive agents, headless tasks and chats outside Mission Control alike.
 * A project's worktrees (<repo>/.claude/worktrees/...) count toward the project.
 */

const CACHE_MS = 60_000
let cache: { at: number; report: UsageReport } | null = null

function monthStart(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

export function monthKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function monthReport(): Promise<UsageReport | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.report
  try {
    const report = await queryIndex<UsageReport>('usageReport', monthStart())
    cache = { at: Date.now(), report }
    return report
  } catch {
    return null
  }
}

/** Forgets cached spend, e.g. after a task finished. */
export function invalidateBudgets(): void {
  cache = null
}

/** Spend this month for a project folder and everything under it. */
export function spentFor(report: UsageReport, projectPath: string): number {
  const root = normalizePath(projectPath)
  return report.byProject
    .filter((p) => {
      const path = normalizePath(p.projectPath || '')
      return path === root || path.startsWith(root + '\\') || path.startsWith(root + '/')
    })
    .reduce((sum, p) => sum + p.cost, 0)
}

export async function projectBudget(projectPath: string): Promise<BudgetState | null> {
  const budget = loadStore().projectMeta[normalizePath(projectPath)]?.monthlyBudgetUsd
  if (!budget || budget <= 0) return null
  const report = await monthReport()
  if (!report) return null
  const spent = spentFor(report, projectPath)
  return { budget, spent, ratio: spent / budget, over: spent >= budget }
}

/** Budget state of every project that has a budget, keyed by project path. */
export async function allBudgets(): Promise<Record<string, BudgetState>> {
  const meta = loadStore().projectMeta
  const out: Record<string, BudgetState> = {}
  for (const [path, m] of Object.entries(meta)) {
    if (!m.monthlyBudgetUsd) continue
    const state = await projectBudget(path)
    if (state) out[path] = state
  }
  return out
}

/** Warns once per month per project when spend passes 80% of its budget. */
export async function checkBudgetWarnings(notify: (projectPath: string, state: BudgetState) => void): Promise<void> {
  const month = monthKey()
  const budgets = await allBudgets()
  for (const [path, state] of Object.entries(budgets)) {
    if (state.ratio < 0.8) continue
    if (loadStore().budgetWarned[path] === month) continue
    updateStore((s) => {
      s.budgetWarned[path] = month
    })
    notify(path, state)
  }
}
