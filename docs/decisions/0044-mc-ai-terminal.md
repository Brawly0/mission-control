# 0044: mc as an AI terminal; 0.37's agent-pane terminal removed

Date: 2026-11-16. Status: accepted. Supersedes 0043.

## Context
0.37.0 shipped an "AI terminal" layer over the Claude and Codex panes (activity strip, approval bar, prompt box, brand
palette, GPU renderer, file links; ADR 0043). The user's complaint ("it doesn't feel like an AI terminal") was about
the **mc** terminal, not those panes, which they were happy with. They asked to undo 0.37 and work on mc instead.

## Decision
- **0.37 is reverted whole** (`git revert e6dd14d`): the panes are back to 0.36, including the default xterm theme
  and renderer, and the three xterm addons are dropped. The `MC_SMOKE_TERM` self-test goes with it; ADR 0043 stays, marked superseded.
- **The mc work lives in the CLI** (`cli/src`), not the app, so it is the same in Mission Control and a plain terminal:
  - `ui.ts` `promptBox`: a framed `mc ›` prompt with repo, branch and settings in its top edge. After Enter the
    typed line is replaced by the request wrapped inside a closed box, so the scrollback reads like a chat. readline
    keeps history (↑) across prompts and completes slash commands.
  - `ui.ts` `Live`: one row per running agent repainted every 100 ms at the bottom (spinner, current tool, timer,
    tool and file counts). Only file changes (once per file), the agent's own words and errors scroll above it. On
    stop it leaves one ✓/✗ line per agent. Rows are cut to the terminal width so cursor-up repaints never drift.
    Without a TTY every event is printed as a line, as before.
  - `commands.ts`: slash commands (pure, tested). Settings changed with them (`/review`, `/full`, `/yes`,
    `/planner`, `/model`) last for the session.
  - `card()`: rounded cards for the plan, the commands and the result, with Claude and Codex in two columns when
    each column has at least 36 characters.
  - After a run in the interactive prompt, one key merges (`m`), lists changed files (`d`) or throws it away (`c`).
- mc is 0.2.0.

## Consequences
- The spinner writes output during runs, so the app's output-based status shows "working" for the whole run and
  "idle" at the prompt.
- Typing past the terminal width at the prompt wraps over the box edge until Enter; the redraw then fixes it.
- Approvals, prompt history and pasted images in the Claude/Codex panes are gone again; that is what was asked.
