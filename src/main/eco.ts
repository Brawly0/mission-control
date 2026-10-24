import { app } from 'electron'
import type { EcoSettings } from '../shared/types'
import { coachLevel, coachMessage } from '../shared/skills'
import { windowLabel } from '../shared/planUsage'
import { writeEcoPlugin } from './ecoPlugin'
import { loadStore } from './store'
import { contextUsage } from './spend'
import { getRateLimit } from './tasks'

/**
 * Eco mode (ADR 0015): what Mission Control changes in the chats and tasks it starts so they
 * use less of your plan (model, effort, earlier compaction, the eco:coach skill), and the coach
 * that tells Claude when a chat has grown long.
 */

const DEFAULTS: EcoSettings = { enabled: false, model: 'sonnet', effort: '', autocompactTokens: 150_000, coach: true, skill: true }

export function ecoSettings(): EcoSettings {
  return { ...DEFAULTS, ...loadStore().settings.eco }
}

let pluginDir: string | null = null

/** The eco plugin's folder, written to the app's data folder on first use. */
export function ecoPluginDir(): string {
  if (!pluginDir) pluginDir = writeEcoPlugin(app.getPath('userData'))
  return pluginDir
}

/** Extra arguments for a launch while eco mode is on ("=" forms, so a prompt after them is never read as a value). */
export function ecoLaunchArgs(): string[] {
  const s = ecoSettings()
  if (!s.enabled) return []
  const args: string[] = []
  if (s.effort) args.push(`--effort=${s.effort}`)
  if (s.autocompactTokens >= 100_000) args.push(`--autocompact=${Math.round(s.autocompactTokens / 1000)}k`)
  if (s.skill) args.push(`--plugin-dir=${ecoPluginDir()}`)
  return args
}

/** Model eco mode uses when nothing more specific was chosen. */
export function ecoModel(): string | undefined {
  const s = ecoSettings()
  return s.enabled && s.model ? s.model : undefined
}

/** Highest coach level already sent per chat, so each level is said once. */
const coached = new Map<string, number>()
/** Plan windows already mentioned, per chat ("five_hour@<reset minute>"). */
const planNoted = new Set<string>()

/**
 * Text to add to your next prompt for Claude (UserPromptSubmit), or null. Fires once when a chat
 * passes 60% and once at 85% of its compaction window, and once per plan window when a limit
 * is at 85% or more, or on pace to run out within the hour.
 */
export async function coachPrompt(sessionId: string | undefined): Promise<string | null> {
  const s = ecoSettings()
  if (!s.enabled || !s.coach || !sessionId) return null
  const usage = (await contextUsage([sessionId]))[sessionId]
  const window = s.autocompactTokens >= 100_000 ? Math.min(s.autocompactTokens, usage?.window || Infinity) : usage?.window || 0
  let level = usage ? coachLevel(usage.tokens, window) : 0
  if (level <= (coached.get(sessionId) ?? 0)) level = 0
  else coached.set(sessionId, level)

  let plan: string | undefined
  const w = getRateLimit()?.windows.find((x) => x.name === 'five_hour')
  if (w) {
    const pct = Math.round(w.utilization * 100)
    const soon = !!w.forecast?.runsOutAt && w.forecast.runsOutAt - Date.now() < 3_600_000
    const key = `${sessionId}:${w.name}@${Math.round(w.resetsAt / 60_000)}`
    if ((pct >= 85 || soon) && !planNoted.has(key)) {
      planNoted.add(key)
      const resets = w.resetsAt ? new Date(w.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'soon'
      plan = `The user's ${windowLabel(w.name, true).toLowerCase()} limit is at ${pct}%${soon ? ' and on pace to run out within the hour' : ''} (resets ${resets}).`
    }
  }
  return coachMessage(level as 0 | 1 | 2, usage?.tokens ?? 0, window, plan)
}
