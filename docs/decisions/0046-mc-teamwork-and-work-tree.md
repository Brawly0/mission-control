# 0046: mc picks how much teamwork a request needs; live work tree

Date: 2026-11-17. Status: accepted. Builds on 0042 and 0044.

## Context
The user asked for the mc terminal to read like the Claude Code or Codex CLI (clear thinking, what each agent is working on,
a good prompt), one clear output per run, and for the two agents to work together in a way that saves tokens and is faster.
Mid-way they shared their own Claude Code mod ("live-work": an animated tree of boxes above the prompt) and asked for mc to
look like it with both agents.

Before this, every request was split in two, even a question or a one-line fix: two builders, two reviewers, a planner, and
each builder explored the repo again from scratch.

## Decision
- **Routing in the planner** (`plan.ts`): the planner reads the repo once and replies with a mode:
  `answer` (it answers itself; no worktree, nobody else runs), `solo` (one owner builds; the other reviews the diff) or
  `split` (two halves with disjoint files, as before). `/mode` / `--mode` lets the user force `split`, or name one agent,
  which skips planning entirely. Plans without a mode are still read as `split`.
- **Fewer repeated tokens**: the plan carries `context` (relevant files, conventions, check commands) into every builder
  prompt. A reviewer that built the other half continues its own session (`claude --resume`, `codex exec resume`) with a
  short prompt; if that fails it reviews from scratch. A half with an empty diff isn't reviewed.
- **One clear result**: builders end with a fixed report (Changed / Checked / Notes), reviewers with `Verdict: ok|fixed`.
  `parseReport` reads them and the Done card shows one list per section with a coloured bullet per agent. Replies that
  ignore the format still show (their first line).
- **Transcript** (`agents.ts`, `ui.ts`): every tool call, a result line for commands and failed tools, edit sizes (+/−),
  Codex reasoning and to-do steps, Claude's thinking token count (its text is hidden in `-p` mode), Markdown answers.
- **Live work tree** (`tree.ts`, pure and tested): an mc header line, then one column per agent (side by side from 84
  columns, stacked below that): agent box with wings and stars, a trunk with a pulse, one box per folder / terminal / search /
  web / connector with up to 3 items then "+N more", heavy animated borders while working, green glow and sparkles when done,
  an activity line with a blinking cursor. It shrinks (fewer items, fewer boxes, then one line per box) to fit 70% of the
  screen height, and collapses to one summary line per agent when the phase ends. Colours follow the work (mood) or a fixed
  `/aura`. `/view lines` and small terminals (< 18 rows or < 60 columns) keep the one-row-per-agent view.
- **Settings** live in `%APPDATA%\mc\settings.json` (`~/.config/mc` elsewhere, `MC_SETTINGS_DIR` for tests), never `~/.claude`.
- **Input stays in raw mode during runs.** Switching to cooked mode (for a real Ctrl+C) and back lost the first keys typed
  after a run on Windows (the `m` to merge). mc now keeps raw mode, takes the keypress listeners off readline while agents
  run, and turns `\x03` into SIGINT itself.
- mc is 0.3.0.

## Consequences
- A question costs one planner turn instead of a full split run; small fixes cost one builder and one review.
- The planner's JSON is bigger (context), and planning still runs for every request in `auto`.
- The tree repaints up to ~40 lines every 100 ms in one synchronized write; terminals without synchronized output may flicker slightly.
- Not verified with the real Claude and Codex CLIs end to end; checked with fake CLIs in a real pseudo-terminal, unit tests,
  and the `MC_SMOKE_MC` self-test. The real event formats (thinking tokens, tool results, `codex exec resume` flags) were
  checked against the installed CLIs (Claude Code 2.1.326, codex-cli 0.169.0).
