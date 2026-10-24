/**
 * Skills and the eco coach (ADR 0015): reading skill uses out of chat transcripts, and what
 * the coach tells Claude when a chat grows. Pure, unit-tested.
 */

/** Claude Code's own slash commands: typed like skills, but not skills. */
export const BUILTIN_COMMANDS = new Set(
  'add-dir agents bashes bug clear compact config context cost doctor effort exit export fast feedback help hooks ide init install-github-app keybindings login logout mcp memory model output-style permissions plugin plugins pr-comments privacy-settings release-notes rename resume review rewind sandbox security-review skills status statusline terminal-setup todos upgrade usage vim quit loop schedule'.split(' ')
)

export interface SkillUseRow {
  /** Unique per use, for de-duplicating streamed lines. */
  id: string
  skill: string
  how: 'claude' | 'you'
}

/** Skill uses in one transcript line: Claude calling the Skill tool, or you typing /name. */
export function skillUsesIn(e: any): SkillUseRow[] {
  const out: SkillUseRow[] = []
  const content = e?.message?.content
  if (e?.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type !== 'tool_use' || b.name !== 'Skill') continue
      const skill = String(b.input?.skill ?? b.input?.command ?? '').replace(/^\//, '').trim()
      if (skill) out.push({ id: String(b.id ?? `${e.uuid}:${skill}`), skill, how: 'claude' })
    }
  }
  if (e?.type === 'user' && !e.isMeta) {
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : ''
    const m = /<command-name>\/?([\w:.-]+)<\/command-name>/.exec(text)
    if (m && !BUILTIN_COMMANDS.has(m[1].toLowerCase())) out.push({ id: String(e.uuid ?? `${e.timestamp}:${m[1]}`), skill: m[1], how: 'you' })
  }
  return out
}

/** Rough token count for text: about four characters per token. */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * How far along a chat is: 0 fine, 1 getting long (60% of the compaction window), 2 close to
 * compaction (85%). The window is the eco autocompact setting, or the model's context window.
 */
export function coachLevel(tokens: number, window: number): 0 | 1 | 2 {
  if (!window || tokens < 0.6 * window) return 0
  return tokens < 0.85 * window ? 1 : 2
}

/** What Mission Control adds to your next prompt for Claude when a chat crosses a level (or a plan limit is nearly used up). */
export function coachMessage(level: 0 | 1 | 2, tokens: number, window: number, plan?: string): string | null {
  const k = (n: number) => `${Math.round(n / 1000)}k`
  const lines: string[] = []
  if (level === 1) {
    lines.push(
      `[Mission Control eco] This chat is about ${k(tokens)} tokens, and every reply re-reads all of it. At the next natural stopping point (not mid-task), suggest to the user in one line either /compact with a focus or a briefing plus a fresh chat (the eco:coach skill has the details). Say it once, then carry on with their request.`
    )
  } else if (level === 2) {
    lines.push(
      `[Mission Control eco] This chat is about ${k(tokens)} tokens${tokens < window ? `, close to auto-compaction at ${k(window)}` : ', far past the point where compacting pays off'}. Before starting any large new step, recommend compacting now with a focus (give the exact /compact command) or writing a briefing and continuing in a fresh chat. Keep it to one or two lines, then do what the user asked.`
    )
  }
  if (plan) lines.push(`[Mission Control eco] ${plan} Prefer the leanest way to do the user's request.`)
  return lines.length ? lines.join('\n') : null
}
