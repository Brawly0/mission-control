# 0030: Live task terminals

Date: 2026-10-28

## Context

Background tasks (`claude -p --output-format stream-json`, `codex exec --json`) ran out of sight: the board showed one activity line per card and the drawer a short event list. You couldn't watch a task, or a team's agents, work the way you watch an agent terminal.

## Decision

The Tasks page has two layouts, **Board** and **Terminals** (saved in the UI state; Board by default). Terminals shows a tile for every running task, team members and planners included, plus runs that finished since the app opened (until dismissed). Pressing Start on the Tasks page switches to Terminals and brings that task forward; a running card's **Terminal** button does the same. The task drawer gets a **Terminal** tab, opened by default while the task runs.

- **Background runs keep the headless runner.** Their JSON lines are still the source of truth for status, cost, results and team scheduling. `src/shared/taskConsole.ts` (pure, unit-tested) also formats each event as CLI-like terminal text: `● Bash(npm test)`, the first lines of its output under `⎿`, replies, and `✓ Done $0.04 · 3 turns`. The main process keeps up to 400 KB per task for this app session (`getTaskOutput`) and streams new text (`tasks:output`). The tile is a read-only xterm. Runs from before a restart are rebuilt from their saved events. Output isn't written to the store.
- **Interactive tasks show their real PTY.** Starting one from Tasks no longer switches to Agents (`LaunchOptions.stayInView`). The tile is a second view of the same agent terminal, and you can type in it.
- **One terminal, several panes.** `terminalBus` now keeps a 300 KB history per terminal and replays it to a pane that opens later. Only one pane per terminal sends input: the one shown or typed in last. xterm answers terminal queries itself, so two panes both sending input would type every reply twice. The smoke test checks that one key arrives exactly once.

## Not chosen

Running background tasks inside PTYs as interactive CLIs: interactive sessions don't exit when done and print no machine-readable result, which the queue, chains, checks and teams depend on. Rendering raw stream-json was unreadable.

## Verification

`src/shared/taskConsole.test.ts` covers the formatter. `MC_SMOKE_TEAM=1` now checks the background team tiles during and after the run, and an interactive task whose PTY appears in Tasks → Terminals without leaving the page and takes input once.
