# Session briefing: mc fixes, slash menu, short Done card, agent grids — shipped as 0.39.1 and 0.40.0 (2026-11-18)

## Goal

Make the **mc terminal** (Claude + Codex on one prompt, `cli/src`) dependable and easy to read:
- fix the errors the user hit: a task died with an error, and the screen glitched when the pane shrank next to other terminals;
- never ask anything after the prompt (no y/n, no menu after a run);
- check mc's own run (slash commands + `/` menu) and make the Done card short, because the user "saw a lot of points and didn't know what it did".
Then release everything, including Codex's Agents-tab grid work.

## Done and verified

| Item | State |
| --- | --- |
| **v0.39.1** released: commit `807fa7a` | ✅ https://github.com/Brawly0/mission-control/releases/tag/v0.39.1, 4 assets, release gates PASS |
| **v0.40.0** released: commit `c5ce9da` (includes mc's run `6632794`) | ✅ https://github.com/Brawly0/mission-control/releases/tag/v0.40.0, 4 assets, gates PASS |
| Fix: "The plan could not be read: the Codex part is missing" (planner put solo work under the other agent's key) | ✅ unit test with the real reply; fake-agent replay builds |
| Unreadable plan no longer stops the run: prose → shown as the answer; broken JSON → one-agent build from the request | ✅ typecheck/tests; not hit live |
| Resize glitches: live status rows overflowed in narrow panes; clearing didn't count rows re-wrapped by the terminal; prompt box broke on resize | ✅ pty driver resizing 110→66→50→110 during a run and at the prompt: 0 leftover frames |
| Pasted text from mc's own box drops the `│` edges (`unframe`) | ✅ unit test |
| No "Start building?" and no after-run merge menu; `/yes` removed, `-y` still accepted | ✅ pty: two requests in a row, nothing else typed |
| mc's run 7da2 (`/` menu under the prompt, `/clear /usage /model /new /version`, aliases) reviewed and merged | ✅ typecheck, tests, build, and I drove the menu in a pty (the agents couldn't) |
| Value rows in the menu get their own help (`VALUE_HELP`) instead of repeating the command's help | ✅ |
| Short Done card (`cli/src/result.ts`): one line per agent, merged checks, one review line, ≤2 user notes; `/report` shows the full replies + resume commands | ✅ unit tests on the real 7da2 reports (inline snapshot), fake-agent end-to-end |
| Report format now asks for `Summary:` + short lines; nested bullets ignored by `parseReport`; transcript agent text capped at 4 lines | ✅ tests |
| Codex's grid work (Agents tab + task agent workspace): presets up to 8×8, drag/Alt+arrows to move, snapping dividers, Reset grid | ✅ reviewed, typecheck/tests, its Electron check 8/8 PASS |
| Full suite | ✅ typecheck, **443 tests** (47 files), build |

**Not verified:**
- The new Done card, the `Summary:` report line and the plan fallback with the **real** Claude/Codex CLIs (only fake agents).
- Resize behaviour inside the real Mission Control app (verified with node-pty + @xterm/headless, which re-wraps like the app's xterm; the app sets no `windowsPty`).
- That the user has updated to 0.40.0.

## Decisions and why

- **Never ask after the prompt.** The user: "i dont want to type anything else". Building starts right after the plan; after a run mc prints `/merge <id> · /clean <id> · /report` inside the Done card and returns to the prompt. Ctrl+C still stops.
- **Solo plans use a neutral `work` key**, and the parser also accepts the owner's key or the other key. The real failure was the planner copying the old example (`"owner":"claude","claude":{…}`) while choosing Codex.
- **Clearing counts re-wrapped rows** (`rowsTaken(widths, cols)`): Live stores the visible width of each drawn line and computes rows at the current width. Node on Windows only sees resizes while stdin is read in raw mode; mc does that during runs and at the prompt, so sizes were never stale (traced).
- **Done card is short by design; detail goes to `/report`.** Agents still write full replies; mc merges checks by command (`npm.cmd` → `npm`, split at `": "` so `cli:build` stays whole), drops notes addressed to the other agent, and caps lines. An expected failure ("… (expected)") shows a dim `–`, not ✗.
- **mc's run was merged before the output work** because both touched `main.ts`/`ui.ts`.
- **Both releases went out without showing the notes first**: the user said "commit and release everything" each time; notes were shown afterwards.
- No ADR written: these are fixes and UI refinements on ADR 0046's design.

## Open problems

- Cards already printed (Plan, Done) still re-wrap badly when the pane shrinks afterwards. Scrollback can't be redrawn; Claude Code behaves the same.
- If the frame is taller than the screen after a shrink, the part above the top can stay in scrollback (rare: the tree is capped at 70% of rows).
- The menu's `Enter` picks the first match for a half-typed `/word`; a pasted multi-line request whose line starts with a partial command could be altered. Edge case, not seen.
- `/model codex` only suggests `gpt-6-astra` (read from the local Codex config by Codex); free text still works.
- Codex's grid change removed "last cell stretches over empty columns" and the hidden archived-planner panel in task grids. Intentional per its work, not confirmed with the user.
- Carried over: `MC_SMOKE_TEAM=1` fails; `npm run dev` exits while the installed app runs; cosmetic items from the 0.39.0 briefing (nested backticks, pulse dot over `├`, typing past width wraps over the box edge).
- Old worktrees/branches `mc/agent-*` and `mc/duo-0d92/4350/4f13/cac7` are still there. Not from this session's work; leave them unless the user asks.

## Next steps

1. Ask the user to update (top bar **Update** → **Restart**) and do one real mc run. Check the Done card reads well with real agents and that both write a `Summary:` line.
2. If the card still feels long, tune `cli/src/result.ts` (it's pure and unit-tested; the snapshot in `result.test.ts` shows the exact output).
3. Fix whatever the user reports in the grids (`PanelGrid.tsx`, `panelGrid.ts`) or mc.
4. Only if asked: the cosmetic items above, cleaning old worktrees, `MC_SMOKE_TEAM`.

## Gotchas

- **Git Bash mangles `\n` and backslashes** in `sed`, heredocs and `node -e`. It broke a test file this session. Use Edit/Write, or a script file, for anything containing `\`.
- **pty test harness** (copy it if the scratchpad is wiped; the old copy is in the previous session's scratchpad `…\d7bea120-…\scratchpad\mcsim`): `C:\Users\bsbra\AppData\Local\Temp\claude\612afe87e16ebacc\b5f9917c-7aaa-4237-9c56-ca847f00de7c\scratchpad\mcsim\`
  - `resize.cjs` (resizes during a run and at the prompt; `REQ=` env sets the request), `noask.cjs` (no prompts), `done.cjs` (Done card + `/report`), `menu.cjs` (slash menu; `MCBIN=` path), `drive.cjs` (old full flow), `probe.cjs` (Windows resize events)
  - fake CLIs in `bin/`; `fake-claude.mjs` has a "basic set of commands" case that reproduces the wrong-key plan
  - Always set `MCSIM_LOG` and `MC_SETTINGS_DIR`; delete every case variant of `Path` before setting `PATH`; clean `repo/.claude/worktrees` and `mc/duo-*` branches between runs.
- **Finding what happened in a user's mc run:** run records are in `<repo>/.git/mc-runs/<id>.json`; headless agent sessions are `~/.claude/projects/<cwd>/*.jsonl` with `"entrypoint":"sdk-cli"`, and Codex rollouts are in `~/.codex/sessions/YYYY/MM/DD/`. A failure before the worktree leaves no run record.
- **Releases:** never commit `docs/briefings/*.md` (public repo). Next version must be higher than 0.40.0. Check the repo isn't archived first.
- Real Claude appends "Shell cwd was reset to …" to Bash output in this environment; ignore it.

## Files that matter

- `cli/src/main.ts`: `run` (plan → fallback → build → review → commit → `showResult`), `showResult`, `lastRun` + `showReport` (`/report`), `slash`, `interactive`, `sessionRuns` (`/usage`), module-level `earlier` (`/new`).
- `cli/src/result.ts` (+ `result.test.ts`): `resultLines`, `gotLine`, `compactChecks`, `userNotes`, `reviewLine`.
- `cli/src/plan.ts`: `parseDuoPlan` (solo `work` key), `SOLO_SHAPE`, `REPORT` (Summary + brevity), `parseReport` (`summary`, nested bullets skipped), review prompt wording.
- `cli/src/ui.ts`: `rowsTaken`, `Live` (`drawn` widths, narrow-safe `line`), `promptBox` (resize redraw, slash menu via `_ttyWrite` override), `unframe`, menu helpers (`cycle`, `menuWindow`, `pickIndex`, `enterAction`, `menuLines`).
- `cli/src/commands.ts`: `COMMANDS` (incl. `report`), `ALIASES`, `VALUES`, `VALUE_HELP`, `suggestions`, `complete`.
- Grids: `src/renderer/src/components/PanelGrid.tsx`, `src/renderer/src/panelGrid.ts` (+ test), `AgentsView.tsx`, `TaskAgentWorkspace.tsx`, `workspace.css`, `scripts/grid-check/` (`node scripts/grid-check/build.mjs && npx electron scripts/grid-check/check.cjs`).
- Docs: `docs/ROADMAP.md` (0.39.1 and 0.40.0 sections), `cli/README.md`. mc is **0.4.0**, the app **0.40.0**.
