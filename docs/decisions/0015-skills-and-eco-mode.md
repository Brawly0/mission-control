# 0015: Skills page, eco:coach skill and Eco mode

**Status:** accepted · 2026-10-24

## Context

The user wants to use less of their Claude plan and to make better use of skills. Their real data (30 days) showed about 99% of the API-equivalent cost on Opus, and nearly all tokens were chat context re-read on every reply (2.3B tokens read against 5.1M written). Their largest recent chat was 944k tokens in a 1M window. Shorter output, which is what output-compressing skills do, barely matters; model choice and chat length do.

## Decisions

### Skills page
- Lists every skill Claude Code can load, **only reading** them:
  - personal skills in `~/.claude/skills`, following folder links, since most of the user's skills are links to cloned repos;
  - plugin skills, found through `~/.claude/plugins/installed_plugins.json` and named `plugin:skill`;
  - project skills in each project's `.claude/skills`;
  - Mission Control's own `eco:coach`.
- **Usage comes from the chat index** (schema 7, table `skill_uses`): Claude calling the `Skill` tool (`input.skill`), and the user typing `/name` (`<command-name>` in a user message). Claude Code's own commands are excluded. Skills used but not on disk show as "built-in or removed".
- **Context cost:** name plus description of every skill Claude can call (`disable-model-invocation` skills cost nothing until started), and the SKILL.md size when used. The page points out unused skills and what they add to every chat, but never removes anything: `~/.claude` stays read-only.

### eco:coach skill
- **Shipped as a tiny plugin** (`.claude-plugin/plugin.json` + `skills/coach/SKILL.md`), written to the app's data folder and loaded with `--plugin-dir` into chats Mission Control starts. Nothing is installed into `~/.claude`.
- **What the skill does:**
  - When started: one concrete recommendation (keep going, `/compact` with a focus, hand off with a briefing, or switch model).
  - While active: lean working habits.
- **"Add to a project"** copies it as `.claude/skills/eco-coach` for chats started outside Mission Control. It's an explicit action, in the user's project.

### Eco mode
A global switch (top bar, Ctrl+Alt+L, Settings → Spending) that changes only what Mission Control launches:
- **Model:** Sonnet by default when nothing more specific was chosen. A project's default and the task default still win.
- **`--autocompact`** at 150k by default: the biggest lever, since every reply re-reads the whole chat.
- **`--effort`:** optional.
- **The eco:coach plugin.**
- **The coach:** the app's existing hooks call its local server, which now answers `UserPromptSubmit` with `additionalContext`. It speaks once when a chat passes 60% and once at 85% of its compaction window, and once per 5-hour window when the session limit is at 85% or more, or on pace to run out within the hour. It answers within 1.5 s (the hook's curl gives up at 3 s) and adds nothing otherwise.
- **`=` forms** (`--autocompact=150k`, `--plugin-dir=…`), so a prompt after them is never read as their value.
- The flags were checked against Claude Code 2.1.310 with one Haiku call: the plugin loads as `eco:coach`, and `--effort` and `--autocompact` are accepted.

## Risks

- Defaulting to Sonnet changes quality for hard work. It's opt-in, and Opus is one `/model opus` away.
- Chats already running keep their launch flags until restarted. The toggle says so.
- The coach adds about 60 tokens to a prompt at most a few times per chat.
