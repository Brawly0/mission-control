# Session briefing: mc duo CLI + Tasks archived (2026-11-16)

## Goal

Build **`mc`**, a custom CLI where one prompt is split between Claude and Codex, who build their halves at the same
time. Make it a first-class launch option in Mission Control (like "chat with Claude / Codex") with its own logo.
Remove the Tasks tab (the user doesn't use it). Ship it all as a release.

GitHub profile work from earlier briefings is **off the table**. The user said "forget github, focus on the app".

## Done and verified

| Item | State |
| --- | --- |
| **v0.36.0 released** (`b94b668`, pushed) | ✅ https://github.com/Brawly0/mission-control/releases/tag/v0.36.0. All 4 assets are present (exe, blockmap, latest.yml, SHA256SUMS). Release gates PASS |
| `mc` CLI in `cli/` | ✅ Two live end-to-end runs on a scratch repo: plan → parallel build → cross-review → commit (2m 16s, $0.64 Claude, 192k Codex tokens). The 6 generated tests pass. `mc merge` and `mc clean` work |
| `mc` installed globally | ✅ `npm link` in `cli/` → `C:\Users\bsbra\AppData\Roaming\npm\mc`, `mc --version` = 0.1.0 |
| `mc` in the app | ✅ `MC_SMOKE_MC=1` self-test PASS: Home card in both themes, an mc terminal opened from the UI, banner shown, `list`, quit |
| Tasks tab hidden | ✅ `MC_SMOKE_POLISH=1` tour PASS; Home screenshots checked at 1440 and 960 in dark and light |
| typecheck, 388 tests, build | ✅ |

**Not verified yet:**
- A full mc run *inside the installed app*. The smoke test only checks the banner, `list` and quit.
- The relative-path display fix (`relativeTo` in `agents.ts`). It is unit-tested but hasn't been seen in a live run.
- The user hasn't updated their installed app to 0.36.0 yet.

## How mc works (ADR 0042)

- `mc "<prompt>"` runs one prompt. Plain `mc` is interactive and asks for prompt after prompt until an empty line. That interactive mode is how the app opens it.
- Steps for each prompt:
  1. **Plan.** The planner (Claude by default, `--planner codex`) runs read-only and returns JSON: `summary`, a shared `contract`, and `claude`/`codex` halves with **disjoint files**. `parseDuoPlan` rejects overlapping or unsafe paths.
  2. **Confirm.** The user approves the plan (`-y` skips this).
  3. **Worktree.** A fresh worktree on `mc/duo-<id>` from HEAD, at `<repo>/.claude/worktrees/duo-<id>`. `.claude/worktrees/` is added to that repo's local `.git/info/exclude`.
  4. **Build.** Both agents run headless in parallel, with the prompt on stdin: `claude -p --output-format stream-json`, `codex exec --json`.
  5. **Cross-review.** Each agent gets the other's summary and a `git diff` of the other's files, and may fix only those files. `--no-review` skips this.
  6. **Commit** on the branch. `mc merge <id>` merges into the current branch and removes the worktree. `mc clean <id>` deletes the run.
- Run records live in `<repo>/.git/mc-runs/*.json`, never in `~/.claude`.
- Default access:
  - **Claude:** `acceptEdits` plus an allowlist of read-only git and test/build commands (`CLAUDE_SAFE`).
  - **Codex:** `workspace-write` sandbox with approvals off.
  - `--full` gives both full access.
- In the app, `TerminalKind = AgentTool | 'shell' | 'mc'`. `isAgentTool()` keeps chats, hooks, handoffs, briefings and the opening prompt Claude/Codex only. Ways in: the Home card **Duo with mc**, the **mc** button on the project page, New → mc session, the palette, **Ctrl+Alt+D**.
- The installer ships `cli/dist/mc.mjs` as `resources/mc/mc.mjs` (`extraResources`). `pty.ts` runs it with **Node from PATH**. If Node is missing, the tab shows a message instead.

## Decisions and why

- **Tasks hidden, not deleted** (`src/shared/features.ts → TASKS_UI = false`). The user picked "Only the Tasks tab". The engine stays because Docs vault builds and saved schedules use it. Setting the flag to `true` brings the tab back.
- **CLI in this repo** (the user's choice). It reuses `codexTaskArgs` from `src/shared` and is bundled by Vite (`cli/vite.config.mts`). `npm run build` now also builds the CLI, so releases include it.
- **Node from PATH, not Electron's Node.** `ELECTRON_RUN_AS_NODE` was tried. Electron is a GUI-subsystem exe on Windows, so its output never reaches a ConPTY: it exits with no output. Codex is an npm package, so Node exists whenever mc can work.
- **Each half owns separate files, plus a shared contract.** This is what keeps two agents in one checkout from colliding. Files changed outside both halves are listed in the summary.
- **Two briefings left uncommitted** (`2026-11-12-2143-github-…`, `2026-11-16-0202-…`). The repo is public and they name teammates and personal context.

## Open problems

- The **first `publish-release` attempt failed** with the cause cut off in the log. The re-run succeeded with no changes. If it happens again, capture the full log to a file.
- mc tabs show **"working"** while idle at the `mc ›` prompt. The status comes from output timing, since mc has no hooks.
- Claude's cost is shown in dollars; Codex only reports tokens.
- If one worker fails, nothing is committed. The worktree is kept, with resume commands for both sessions. No automatic retry.
- The GitHub MCP server's auth header was broken earlier in the session. It reconnected later, but that wasn't checked.

## Next steps

1. The user updates the app to 0.36.0 (top-bar **Update**, or Settings → Updates → Check now → Restart).
2. Run a real mc session from the app on a small project (Ctrl+Alt+D). Check that the progress lines show relative paths, the review verdicts, the commit, and `mc merge`.
3. Possible follow-ups (only if the user asks):
   - Status light for mc tabs: idle at the prompt vs. a run in progress.
   - `mc` options in the app, such as `--no-review` and planner choice.
   - An "open the branch diff" button after a run.
4. Remaining roadmap ideas: "Run this for me", code signing, parallel chain branches, an MCP overview per project.

## Gotchas

- **Backslashes get mangled through shell heredocs and `node -` scripts** (this bit three times). Write TS that contains `\` or regexes with the Edit/Write tools.
- No Python on this machine; use node or PowerShell.
- Smoke tests: launch Electron with `Start-Process -WindowStyle Hidden -Wait` plus redirected output and a fresh `MC_SMOKE_PROFILE`.
- `src/main/*` modules that import `hub.ts` or Electron can't be imported in vitest. Keep testable logic pure (`cli/src/plan.ts`, `agents.ts` parsers).
- Commit and release only when the user asks in that turn. The release skill says to confirm the notes first; the user had pre-approved this time.
- `mc` needs a git repo with at least one commit. It warns that uncommitted changes aren't carried into the worktree.

## Files that matter

- CLI:
  - `cli/src/main.ts`: commands, interactive loop, run flow, Ctrl+C.
  - `cli/src/plan.ts`: prompts, `parseDuoPlan`.
  - `cli/src/agents.ts`: spawning, stream parsers, `CLAUDE_SAFE`.
  - `cli/src/git.ts`: worktree, diff, commit, run records.
  - `cli/src/ui.ts`: terminal output.
  - Tests `cli/src/*.test.ts`; `cli/README.md`, `cli/logo.svg`, `cli/vite.config.mts`, `cli/package.json`.
- App:
  - `src/shared/features.ts` (`TASKS_UI`), `src/shared/terminalKind.ts`, `src/shared/types.ts` (`TerminalKind`).
  - `src/main/pty.ts` (`mcScriptPath`, mc spawn), `src/main/terminals.ts` (no opening prompt for mc), `src/main/mcDuoSmoke.ts`, `src/main/smoke.ts`.
  - `src/renderer/src/components/McLogo.tsx`, `codex.css` (mc styles).
  - Launch points and Tasks hiding: `HomeView.tsx`, `home.css`, `ProjectView.tsx`, `TopBar.tsx`, `AgentsView.tsx`, `app/commands.ts`, `app/shortcutActions.ts`, `shortcuts.ts`, `Sidebar.tsx`, `App.tsx`.
- Docs: `docs/decisions/0042-tasks-archived-and-mc-duo-cli.md`, `docs/ROADMAP.md` (0.36.0 section), `docs/ARCHITECTURE.md` (mc CLI section), `docs/DEVELOPMENT.md` (`MC_SMOKE_MC`).
