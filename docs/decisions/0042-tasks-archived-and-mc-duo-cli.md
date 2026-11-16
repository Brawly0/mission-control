# 0042: Tasks tab archived; `mc` duo CLI

Date: 2026-11-16. Status: accepted.

## Context
The user doesn't use the Tasks tab (board, composer, templates, queue, agent teams). They want a terminal command
where one prompt is split between Claude and Codex, who build their halves at the same time.

## Decision
- **Tasks is hidden, not deleted.** `src/shared/features.ts` has `TASKS_UI = false`. With it off, the sidebar
  (Tasks, Templates), palette commands, task shortcuts (`newTask`, `goTasks`, `templates`, `toggleQueue`), the
  New menu entry, the tray entries, the Settings → Tasks tab, Home's New Task / Use Template cards, Tasks stat and
  Tasks panel, and task items in the Inbox and Fix problems are all left out. `setView('tasks')` lands on Home.
  The engine (`src/main/tasks.ts`, templates, scheduler, queue) is unchanged because Docs vault builds and any
  saved schedules still run through it. Setting the flag back to `true` restores the tab.
- **`mc` lives in `cli/`** in this repo and is bundled by Vite into one Node script, `cli/dist/mc.mjs`
  (`npm run cli:build`; `npm link` inside `cli/` puts `mc` on PATH). It reuses `codexTaskArgs` from `src/shared`.
- **Flow:** plan → confirm → build in parallel → cross-review → commit.
  1. The planner (Claude by default, `--planner codex`) inspects the repo read-only and replies with JSON:
     `summary`, a shared `contract` (names, signatures, formats both halves code against), and one half each for
     Claude and Codex with disjoint file ownership. `parseDuoPlan` rejects overlapping or unsafe paths.
  2. A worktree on `mc/duo-<id>` from HEAD under `<repo>/.claude/worktrees/` (Mission Control already groups
     those chats under the project). `.claude/worktrees/` is added to the repo's local `.git/info/exclude`.
     The user's folder is never touched; uncommitted changes are not carried over (mc warns).
  3. Both agents run headless at the same time (`claude -p --output-format stream-json`, `codex exec --json`),
     prompt on stdin, progress interleaved with coloured tags.
  4. Each agent reviews the other's half, given the other's summary and a `git diff` of their files, and may fix
     only those files. `--no-review` skips this.
  5. Everything is committed on the branch. `mc merge <id>` merges into the current branch and removes the
     worktree; `mc clean <id>` throws it away. Run records live in `.git/mc-runs/`, not in `~/.claude`.
- **Access by default:** Claude `acceptEdits` plus read-only git and common test/build commands; Codex
  `workspace-write` sandbox with approvals off. `--full` gives both full access (bypassPermissions / no sandbox).

- **In the app (0.36.0):** `mc` is a terminal kind next to Claude, Codex and PowerShell (`TerminalKind`,
  `isAgentTool` in `src/shared/terminalKind.ts`). Ways in: the **Duo with mc** card on Home, the **mc** button on
  the project page, New → mc session, the palette and **Ctrl+Alt+D**. The installer ships `cli/dist/mc.mjs` as
  `resources/mc/mc.mjs`; `pty.ts` runs it with **Node from PATH**. Electron's own Node (ELECTRON_RUN_AS_NODE)
  was tried and rejected: Electron is a GUI-subsystem program on Windows, so in a ConPTY its output never shows.
  Codex is an npm package, so Node is present whenever mc can work; without it the tab explains what to install.
  Without a prompt, `mc` is interactive: it keeps asking what to build next until an empty line. mc terminals get
  no opening briefing prompt, chats, hooks, handoffs or briefings (those stay Claude/Codex only).
- **Logo:** two linked rings, Claude orange and Codex blue, with the overlap lit violet (`McLogo.tsx`,
  `cli/logo.svg`).

## Consequences
- Two agents edit one checkout at once; disjoint ownership plus the contract is what keeps them apart. Files
  changed outside both halves are listed in the summary.
- Claude's cost is shown in dollars; Codex reports tokens only.
- If a worker fails, nothing is committed and the worktree is kept, with resume commands for both sessions.
