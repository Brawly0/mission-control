# Session briefing: mc terminal shipped as 0.38.0 (2026-11-17)

## Goal

The user's complaint "it doesn't feel like an AI terminal" (which became 0.37.0) was about the **mc terminal**, not the
Claude/Codex panes. They said: "here is fine so undo everything and work on the mc terminal", then "go ahead release
everything nd commit". GitHub profile work stays off the table.

## Done and verified

| Item | State |
| --- | --- |
| **v0.38.0 released**: commit `9375cbd` on `main`, pushed | ✅ https://github.com/Brawly0/mission-control/releases/tag/v0.38.0, not a draft. All 4 assets present; release gates PASS |
| 0.37 reverted whole (`git revert e6dd14d`): Claude/Codex panes back to 0.36, the 3 xterm addons dropped | ✅ |
| mc framed input box (settings in the top edge; after Enter the request is redrawn inside a closed box) | ✅ |
| One persistent readline for the session: ↑ history, Tab completes `/` commands | ✅ |
| Live status rows per agent (spinner, current tool, timer, tool and file counts); only file changes, agent text and errors scroll above them | ✅ |
| Slash commands: /help /list /merge /clean /review /full /yes /planner /model /status /clear /exit | ✅ |
| Plan and Done cards (Claude and Codex side by side when each column has at least 36 characters, stacked otherwise) | ✅ |
| After a run: `m` merge, `d` files changed, `c` throw away, Enter keeps it | ✅ |
| Ctrl+C mid-run stops the run; unfinished rows show "✗ stopped"; exit code 130 | ✅ |
| typecheck, **395 tests** (43 files), build | ✅ in the repo and in the clean release worktree |
| `MC_SMOKE_MC` (app opens mc, banner, `list`, quit) | ✅ PASS; screenshot checked |
| Full flow in a real pseudo-terminal (node-pty + @xterm/headless) with fake claude/codex CLIs, at 110 and 72 columns, including merge with `m` | ✅ |

**Not verified:**
- A real mc run with the real Claude and Codex.
- Whether the user has updated their installed app to 0.38.0. They were told: top bar **Update** → **Restart**, then `/help` in an mc tab.

## Decisions and why (ADR 0044; ADR 0043 is kept, marked superseded)

- **All the mc work is in the CLI (`cli/src`), not the app**, so mc behaves the same inside Mission Control and in a plain terminal.
- **One readline for the whole session.** Re-creating it for every prompt toggled raw mode and lost a quick Enter: `MC_SMOKE_MC` failed at "Timed out waiting for mc to quit". `ask(q, remember)` keeps only main-prompt answers in history; y/n and one-key answers are taken back out.
- **While agents run, the console goes back to cooked mode** (`holdInput` / `releaseInput` in `Live`), so Ctrl+C is a real signal and keys typed during a run don't echo into the live rows.
- **Live rows are cut to the terminal width minus 1**, so repainting with cursor-up never drifts. Without a TTY, every event prints as a line, the same as before.
- **Release built from a clean worktree** (`git worktree add --detach <scratchpad> 9375cbd`, `npm ci`, `npm run publish-release`). Another session had uncommitted work in this repo, and the installer must not include it.
- Release notes weren't shown for approval first; the user said "release everything" in that turn.

## Open problems

- **Another session's uncommitted changes are in the working tree; they are not mine, so don't commit or revert them blindly.** Ask the user. Nine files: `src/main/ecoPlugin.ts`, `src/main/git.ts`, `src/main/index.ts` (smoke module loaded lazily), `src/main/indexWorker.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/art.css`, `src/renderer/src/components/ChangesPanel.tsx`, `src/renderer/src/projectLook.tsx`, `src/shared/readiness.ts`. They look like startup-speed work.
- Typing past the terminal width at the `mc ›` prompt wraps over the box edge until Enter; the redraw then fixes it.
- `MC_SMOKE_TEAM=1` still fails, as it did before 0.37. Tasks are hidden (`TASKS_UI = false`), and the smoke wasn't updated.
- `npm run dev` exits straight away while the installed app is running (single-instance lock, shared userData).
- Earlier worktrees `.claude/worktrees/agent-c242` and `agent-e40e` exist (branches `mc/agent-*`). They're not from this session; leave them.
- One of my test runs accidentally launched the user's real `claude` in plan mode (read-only, in a scratch repo). The cause: two PATH keys in the environment. It's fixed in the harness.

## Next steps

1. The user updates to 0.38.0 and tries a real mc run. Ask how it feels: box, live rows, cards, keys.
2. Fix whatever they report, in `cli/src/ui.ts` and `cli/src/main.ts`.
3. Ask about the other session's 9 uncommitted files: is that work finished, and should it be committed?
4. Only if asked: fix or skip `MC_SMOKE_TEAM`; give `npm run dev` its own userData and drop the single-instance lock under dev.

## Gotchas

- **Answered last turn:** the user's "web project" is `Desktop\Web Services Project`. The sidebar shows it as **COM4381** because the name comes from the README's first heading. Right-click → Rename project changes only the name shown in the app.
- Backslashes get mangled by heredocs and `sed` in Git Bash: use Edit/Write for anything containing `\`. There's no Python on this PC.
- In node-pty test drivers, delete every case variant of `Path` from env before setting `PATH`, or the child resolves the real CLIs.
- The test harness lives in the scratchpad (`mcsim/`: `drive.cjs`, `ctrlc.cjs`, `bin/fake-claude.mjs`, `bin/fake-codex.mjs`, `@xterm/headless@5.5.0`). It may be wiped; it's quick to rebuild from this description.
- Smoke runs: `Start-Process -WindowStyle Hidden -Wait` with redirected output, a fresh `MC_SMOKE_PROFILE` under TEMP, `MC_SMOKE_CLEAN=1`, absolute `MC_SMOKE` and `MC_SMOKE_LOG`. Grep the log for `PASS` or `FAILED`.
- Auto-update only offers higher versions; the next release is 0.38.1 or 0.39.0.
- Don't commit `docs/briefings/*.md`: the repo is public. Commit and release only when asked in that turn. Never force-close the installed app.

## Files that matter

- `cli/src/ui.ts`: `promptBox`, `startSession` / `ask`, `Live` (status rows), `card` / `cardInner` / `cardColumn` / `sideBySide`, `wrap` / `cut` / `visible`.
- `cli/src/main.ts`: `interactive`, `slash`, `statusLine`, `showCommands`, `together` (runs agents under `Live`), `showPlan`, `run` (summary card), `afterRun` (m/d/c).
- `cli/src/commands.ts`: `COMMANDS`, `parseCommand`, `onOff`, `complete`. Tests: `cli/src/ui.test.ts`.
- `cli/src/agents.ts` (event parsing, unchanged), `cli/README.md`, `cli/package.json` (mc 0.2.0).
- `src/main/mcDuoSmoke.ts` (`MC_SMOKE_MC`; expects `on one prompt`, `mc ›` and the repo path tail, then `list` and an empty Enter to quit).
- Docs: `docs/decisions/0044-mc-ai-terminal.md`, `docs/decisions/0043-ai-terminal.md` (superseded), `docs/ROADMAP.md` (0.38.0 section).
