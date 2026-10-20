# 0005: Headless tasks via `claude -p` stream-json, run by the main process

**Status:** accepted · 2026-10-20

## Context

The task board needs agents that work without a terminal, report progress as they go, and can run several at once without the user babysitting them.

## Decision

- Run `claude -p --output-format stream-json --verbose` as a plain child process. The prompt goes in on stdin, and output is parsed line by line.
- The main process owns tasks and runs, so they keep going while the window is hidden in the tray, and the UI only renders state.
- Default permission mode is `auto`, where Claude Code's safety classifier approves routine actions. `bypassPermissions` is offered with a warning and is meant for throwaway worktrees.
- Use `--session-id` so every run can be continued interactively later with `--resume`.
- An optional `--max-budget-usd` caps spending per task.

## Alternatives rejected

- **Claude Agent SDK in-process:** another large dependency and auth path, when the installed CLI already has the user's login, settings, MCP servers and hooks.
- **Hidden PTYs with screen scraping:** fragile, with no structured cost or result.
- **The interactive CLI driven by hooks only:** it can't run unattended, because permission prompts block.

## Consequences

- Headless runs can't ask questions. Anything that needs approval outside the chosen mode is refused, and the run ends in Review with Claude's explanation.
- Runs end when the app quits, and are marked so on the next start.
- Stream-json fields are read defensively. Unknown events are ignored, so newer Claude Code versions keep working.
