# Session briefing: new README, mc merges and release 0.41.0 (2026-11-18)

## Goal

1. Give the public repo a README that makes people want to try the app, with real screenshots of agents working.
2. Commit everything, merge the mc branches' recent work, and release.

## Done and verified

- **README rewritten** (commit `eb7c847`, pushed). It has a hero image of 4 live agents, a "Why" section, a tour, a feature table, then shorter install/data/help sections. Images are in `docs/images/` (`agents-grid.png`, `agents-grid-done.png`, `agent-result.png`, `project-chats.png`, `home.png`, `palette.png`, `projects.png`). Old `home-dark.png`/`home-light.png` are kept but no longer referenced. The images load from raw.githubusercontent (200).
- **New self-test `MC_SMOKE_DEMO`** (`src/main/demoShotsSmoke.ts`, dispatched in `src/main/smoke.ts`, documented in `docs/DEVELOPMENT.md`). It takes README screenshots from a demo profile and starts real Claude agents.
- **Briefing fix committed** (`bc79192`): `latestBriefing()` ranks auto-saved briefings and `docs/briefings/` files together, by the name timestamp.
- **Merged `mc/duo-ca48`** (`8182ab3`): mc history per repo, `/chats`, `/brief`, context bars, `/context`.
- **Merged `mc/duo-1192`** (`15231dc`): mc viewport renderer, resize and end-of-run redraw fixes, PgUp history. Conflicts were resolved by hand (see Decisions).
- **Released 0.41.0** (`feat: release 0.41.0 ...`, pushed): https://github.com/Brawly0/mission-control/releases/tag/v0.41.0. Assets verified: exe, blockmap, `latest.yml`, `SHA256SUMS.txt`. Not a draft.
- **Checks:** typecheck, 486/486 tests, build, `node cli/src/ui.pty-smoke.mjs` (real PTY: PASS), release gates PASS.
- **Not verified:** clicking through mc in the installed 0.41.0 app; Ctrl+Alt+B (latest briefing) in the real app.

## Decisions and why

- **Screenshots come from a fake home, never the user's real data.** Their real projects (bot, WBP, trading) and chats must never appear publicly. The demo uses `USERPROFILE=C:\mcdemo-home` (it holds only demo chats copied from `~/.claude/projects/C--code-*`) and sample projects in `C:\code\` (trail-tracker, shortlink, expense-cli, chess-engine).
- **Live agents sign in with the real home.** Before launching agents, the tour sets `process.env.USERPROFILE` back to `MC_DEMO_REAL_HOME`. It doesn't copy `.credentials.json`, because a refresh in a copy could rotate the OAuth token and log the user out.
- **Merge conflicts in `cli/src/ui.ts`:** took 1192's version wholesale (newer, with a viewport renderer and PTY tests), then ported ca48's pieces onto it: `contextPercent/contextColor/contextBar`, `clearDrawn`, `debounce`, `Row.context`, `Live(hint, windowFor)` plus `contextNote`, ctx % in the hint and rows, the `promptBox(..., footer)` param (`hintLines`). `RESIZE_MS` was dropped (unused).
- **`cli/src/main.ts`:** the viewport's `clearHistory` is imported as `clearScrollback`, because `history.ts` also exports `clearHistory` (it clears mc's saved history). All `console.log` calls became `log` (the viewport tracks history).
- **ADR numbers:** both branches added an ADR 0047. 1192's was renamed to `docs/decisions/0048-mc-transient-terminal-frames.md`, and the ROADMAP reference was updated.
- **Older mc branches were not merged** (`mc/duo-0d92` tests, `duo-4350` MCP/plugin overview card, `duo-4f13` Q&A docs, `duo-cac7` test marker). They had been left out of earlier releases too.

## Open problems

- **Demo chats landed in the user's real `~/.claude/projects/C--code-*`** (4 folders). The user's own Mission Control will show 4 demo projects. The user was told they can delete those folders plus `C:\code` and `C:\mcdemo-home`. We must not write to `~/.claude` ourselves.
- The README screenshots show "Unavailable" and "Fix problems (1)" in the top bar, because there are no plan credentials in the demo home. That's cosmetic.
- Release notes were published without showing them to the user first; they're on the release page.
- Leftover from Nov 12: the profile README contact line and whether the user's email should be public (the bio and LinkedIn are already set).

## Next steps

1. Ask whether to merge any older mc branch. `mc/duo-4350` (MCP/plugin overview card) is the likely candidate. It's based on 0.38-era `9375cbd`, so expect conflicts. Re-run the tests after merging.
2. Optionally clean up merged worktrees and branches (`mc/duo-ca48`, `mc/duo-1192`, `mc/agent-*`) in `.claude/worktrees/`. Ask first, because it's destructive.
3. Try mc and Ctrl+Alt+B in the installed 0.41.0.

## Gotchas

- Launching Electron from inside Claude Code: unset every `CLAUDE*` env var first. Otherwise the agents print "Transcript saving is off". Only `CLAUDECODE` triggers `agentEnv()` stripping, and `CLAUDE_EFFORT` is never stripped.
- Claude's folder-trust prompt defaults to "No, exit". The demo tour sends Down, then Enter.
- There's no Python on this PC. Use node for scripted edits. Bash heredocs inside `node -e` mangle `\r` and `\s`, so prefer the Edit tool.
- The `release` skill does everything: `npm run publish-release -- "<notes>"`. Publishing is public and installed copies auto-update.
- Never write to `~/.claude/`. Real money runs in `Desktop\bot`; don't touch it.

## Files that matter

- `README.md`, `docs/images/*`
- `src/main/demoShotsSmoke.ts`, `src/main/smoke.ts` (the `MC_SMOKE_DEMO` dispatch), `docs/DEVELOPMENT.md` (demo tour docs)
- `src/main/briefings.ts` (`latestBriefing`, `briefingTime`)
- `cli/src/ui.ts`, `cli/src/main.ts`, `cli/src/viewport.ts`, `cli/src/history.ts`, `cli/src/ui.test.ts`, `cli/src/ui.pty-smoke.mjs`
- `src/renderer/src/components/TerminalPane.tsx` (wheel handler from 1192 plus debounced fit from ca48)
- `docs/decisions/0047-mc-memory-and-context-bar.md`, `docs/decisions/0048-mc-transient-terminal-frames.md`, `docs/ROADMAP.md`
