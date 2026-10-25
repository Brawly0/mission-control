import { Notification, shell } from 'electron'
import { join } from 'node:path'
import type { BudgetState, RateLimitInfo } from '../shared/types'
import { windowLabel } from '../shared/planUsage'
import { automationHold, takeDueReminders } from './tasks'
import { movedChatList, normalizePath } from './claudeData'
import { queryIndex } from './indexer'
import { checkDigest } from './digest'
import { buildVault, vaultNotes } from './vault'
import { loadStore, updateStore } from './store'
import { showWindow, sendToWindow } from './window'

// Desktop notifications. Clicking one brings the window back on the page it's about. Self-tests show none.

const ICON = join(__dirname, '../../build/icon.png')

/** One notification per chat per day when a chat's estimated cost today passes the limit in Settings. */
export async function checkChatCosts(): Promise<void> {
  const limit = loadStore().settings.chatCostAlertUsd
  if (!limit || process.env.MC_SMOKE) return
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const day = midnight.toLocaleDateString('sv')
  const over = await queryIndex<{ sessionId: string; title: string; projectPath: string; cost: number }[]>('chatsOverCost', midnight.getTime(), limit).catch(() => [])
  const seen = loadStore().costAlerted
  const done = new Set(seen.day === day ? seen.ids : [])
  const fresh = over.filter((c) => !done.has(c.sessionId))
  if (!fresh.length) return
  updateStore((s) => {
    s.costAlerted = { day, ids: [...done, ...fresh.map((c) => c.sessionId)] }
  })
  const moved = new Map(movedChatList().map((m) => [m.id, m.path]))
  for (const c of fresh.slice(0, 3)) {
    const n = new Notification({
      title: `"${c.title.slice(0, 60)}" has cost about $${c.cost.toFixed(2)} today`,
      body: 'Long chats re-read their whole history on every reply. Compacting it or starting fresh with a summary is cheaper. (Estimated at API prices.)',
      icon: ICON
    })
    n.on('click', () => {
      showWindow()
      sendToWindow('navigate', { view: 'project', chat: { projectPath: moved.get(c.sessionId) ?? c.projectPath, sessionId: c.sessionId } })
    })
    n.show()
  }
}

/** After a compaction in a project with "keep docs up to date" on, Claude refreshes its vault (unless automation is on hold). */
async function autoUpdateVault(projectPath: string, projectName: string): Promise<void> {
  if (!loadStore().projectMeta[normalizePath(projectPath)]?.autoDocs) return
  if (await automationHold(projectPath)) return
  const info = await vaultNotes(projectPath).catch(() => null)
  if (!info?.hasIndex) return
  await buildVault(projectPath, projectName, 'update').catch(() => undefined)
}

/** A compaction summary was saved as a session briefing: refresh the vault if asked to, and say where the file is. */
export function briefingSaved(b: { projectPath: string; projectName: string; title?: string }, file: string): void {
  if (process.env.MC_SMOKE) return
  void autoUpdateVault(b.projectPath, b.projectName)
  const n = new Notification({ title: 'Session briefing saved', body: `${b.title || 'A chat'} (${b.projectName}) · ${file.split(/[\\/]/).slice(-3).join('/')}`, icon: ICON })
  n.on('click', () => shell.openPath(file))
  n.show()
}

/** One notification per plan window when it passes your alert level, and one when it runs out. */
export function checkPlanLimits(info: RateLimitInfo): void {
  const level = loadStore().settings.planAlertPercent
  if (!level) return
  const shown = new Set(loadStore().limitAlerted)
  for (const w of info.windows) {
    const pct = Math.round(w.utilization * 100)
    // "pace": not there yet, but heading to run out soon (within the hour for the session, a day for a week).
    const soon = w.name === 'five_hour' ? 3_600_000 : 86_400_000
    const pace = !!w.forecast?.runsOutAt && w.forecast.runsOutAt - info.at < soon
    const kind = pct >= 100 ? 'out' : pct >= level ? 'near' : pace ? 'pace' : ''
    // A reading's reset time wobbles by milliseconds; key on the minute.
    const key = `${w.name}@${Math.round(w.resetsAt / 60_000)}:${kind}`
    if (!kind || shown.has(key)) continue
    updateStore((s) => {
      s.limitAlerted = [...s.limitAlerted, key].slice(-20)
    })
    const resets = w.resetsAt ? new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon'
    const n = new Notification({
      title:
        kind === 'out'
          ? `${windowLabel(w.name, true)} limit reached`
          : kind === 'pace'
            ? `${windowLabel(w.name, true)} limit runs out ~${new Date(w.forecast!.runsOutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} at this pace`
            : `${windowLabel(w.name, true)} limit at ${pct}%`,
      body: kind === 'out' ? `Claude is paused until it resets (${resets}).` : `${pct}% used, resets ${resets}. Smaller models and fresh chats make what's left go further.`,
      icon: ICON
    })
    n.on('click', () => {
      showWindow()
      sendToWindow('navigate', { view: 'usage' })
    })
    n.show()
  }
}

/** The daily digest notification, once a day after the time set in Settings; clicking opens the Inbox. */
export async function showDigest(): Promise<void> {
  if (process.env.MC_SMOKE) return
  const text = await checkDigest().catch(() => null)
  if (!text) return
  const n = new Notification({ title: text.title, body: text.body, icon: ICON })
  n.on('click', () => {
    showWindow()
    sendToWindow('navigate', { view: 'inbox' })
  })
  n.show()
}

/** Tasks whose due time has come (at most three at once); clicking opens the task. */
export function notifyDueReminders(): void {
  for (const t of takeDueReminders().slice(0, 3)) {
    if (process.env.MC_SMOKE) continue
    const n = new Notification({ title: `Due now: ${t.title}`, body: t.projectName, icon: ICON })
    n.on('click', () => {
      showWindow()
      sendToWindow('navigate', { view: 'tasks', taskId: t.id })
    })
    n.show()
  }
}

/** A Windows notification that opens the task board when clicked. */
export function notifyTasks(title: string, body: string): void {
  if (process.env.MC_SMOKE) return
  const n = new Notification({ title, body, icon: ICON })
  n.on('click', () => {
    showWindow()
    sendToWindow('navigate', { view: 'tasks' })
  })
  n.show()
}

export function budgetWarning(projectPath: string, state: BudgetState): void {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath
  const n = new Notification({
    title: state.over ? `${name} is over its monthly budget` : `${name} has used ${Math.round(state.ratio * 100)}% of its monthly budget`,
    body: `About $${state.spent.toFixed(2)} of $${state.budget} this month (estimated at API prices).${state.over ? ' Automation for this project is on hold.' : ''}`,
    icon: ICON
  })
  n.on('click', () => {
    showWindow()
    sendToWindow('navigate', { view: 'usage' })
  })
  if (!process.env.MC_SMOKE) n.show()
  sendToWindow('budgets:changed')
}
