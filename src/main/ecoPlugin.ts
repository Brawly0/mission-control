import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The "eco" plugin Mission Control ships (ADR 0015): one skill, eco:coach, that coaches Claude
 * to use less of your plan. It's written to the app's own data folder and loaded into chats
 * Mission Control starts with --plugin-dir, so nothing is installed into ~/.claude.
 */

export const ECO_SKILL_NAME = 'eco:coach'

export const ECO_SKILL = `---
name: coach
description: Use less of the user's Claude plan. Use when the user asks to save usage, credits, tokens or limits, when a note says this chat is getting long or a plan limit is nearly used up, before a big exploration or refactor, or when the user types /eco:coach. Gives one concrete recommendation (keep going, compact, hand off to a fresh chat, or switch model) and keeps the chat lean.
---

# Eco coach

Every reply re-reads the whole chat so far, so a chat's cost grows with its length. On a long chat almost all usage is that re-reading, not what Claude writes. The biggest savings are, in order:

1. **A smaller chat**: compact, or hand off to a fresh chat with a briefing.
2. **A cheaper model** for routine work: Sonnet (or Haiku for simple, mechanical edits) instead of Opus.
3. **Less going into the chat**: targeted reads and searches, short command output, subagents for broad searches.

## When invoked: coach

Reply in at most 6 short lines:

1. **Where this chat stands**: roughly how long it is (use the size Mission Control reported if there is one) and what's in it that the current work no longer needs (old exploration, long logs, finished side tasks).
2. **One recommendation**, the first that fits:
   - **Keep going**: the chat is small or you're mid-step. Say so and stop.
   - **Compact now**: the work continues on the same thread. Give the exact command with a focus, e.g. \`/compact keep the plan, the files changed and the open bug; drop the exploration\`.
   - **Hand off**: a phase just finished, or the chat drifted. Offer to write a briefing now (template below), then the user starts a fresh chat from it (in Mission Control: New session → from latest briefing).
   - **Switch model**: the next steps are routine (edits, renames, tests, docs). Suggest \`/model sonnet\`, and \`/model opus\` again for hard design or debugging.
3. If a plan limit is close, say how much is left and which option stretches it furthest.

Don't lecture, and don't repeat the advice in later turns unless the situation changed.

## Working lean (always, while this skill is active)

- Search before reading: Grep or Glob to find the spot, then read only the lines you need (offset and limit), never a whole large file "to get context".
- Don't re-read a file you already read unless it changed.
- Use a subagent (Explore) for broad "where is X / how does Y work" searches. Its reading stays out of this chat; only its answer comes back.
- Keep command output short: filter with \`| head\`, \`| tail\`, \`grep\`, \`--quiet\`; don't print whole logs, lockfiles or build output.
- Run independent tool calls together in one step.
- Keep replies short: no restating the plan, no pasting code back that's already in a file, no long summaries unless asked.
- Before a big exploration or refactor, write down the plan in a few lines first, so a handoff stays cheap if the chat gets long.

## Briefing template (for a handoff)

Write it to \`docs/briefings/<YYYY-MM-DD-HHmm>-<topic>.md\` in the project (create the folder if needed):

\`\`\`markdown
# Briefing: <topic>

<date> · <project>

## Goal
## Done and verified
## Decisions (and why)
## Open problems
## Next steps (exact)
## Gotchas
## Files that matter
\`\`\`

Then tell the user: start a new chat and say "Read <path> and continue", or use Mission Control's "New session from latest briefing".
`

const PLUGIN_JSON = {
  name: 'eco',
  version: '1.0.0',
  description: 'Mission Control eco coach: uses less of your Claude plan by keeping chats lean and coaching long ones.',
  author: { name: 'Mission Control' }
}

/** Writes the plugin into `root` (the app's data folder) and returns its folder, for --plugin-dir. */
export function writeEcoPlugin(root: string): string {
  const dir = join(root, 'plugins', 'eco')
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': JSON.stringify(PLUGIN_JSON, null, 2),
    'skills/coach/SKILL.md': ECO_SKILL
  }
  for (const [rel, text] of Object.entries(files)) {
    const file = join(dir, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
  }
  return dir
}
