# Session briefing: v0.16 → v0.18 (Oct 24–25, 2026)

Mission Control is a Windows Electron + React + TypeScript app that manages Claude Code projects, chats, agents and tasks. Repo `C:\Users\bsbra\Desktop\claude-hub` (private `Brawly0/claude-hub`). Releases go to the public repo `Brawly0/mission-control-releases`; the installed app updates from there.

## Goal of this session (the user's asks, in order)
1. **v0.16:** plan cost per chat (share of the weekly limit) and a "Needs you" inbox with a daily digest.
2. **v0.17:**
   - agents tab: minimize, maximize, resize;
   - open all of a project's chats as agents;
   - "what we worked on" when opening or resuming a chat;
   - clearer chat names.
3. "I didn't get the update": an Update button in the app, then release.
4. **v0.18:**
   - fix the quit hang;
   - saved workspaces and sending one prompt to several agents;
   - a **full test of every feature**.

## Where things stand (01:52, Oct 25)
| | State |
|---|---|
| v0.16 + v0.17 | **Committed** (`ca89dd9`), pushed, tagged `v0.17.0`, **released** (3 assets verified). The user is **running 0.17.0** (installed copy seen at 12:30). |
| v0.18 (terminal host, workspaces, Send to…) | **Built, typechecked, 136 unit tests pass, NOT committed, NOT released.** `package.json` is still `0.17.0`. |
| Full test | Running in the background (`scratchpad/full/run-all.ps1`). Batches 1 (screens) and 2 (data) **passed, no errors**. Batch 3 (docs + workspaces) had just started; 4–6 still to run. |

The user asked "is the update live?". Answer given: no; v0.18 releases after the test passes, or after batch 3 if they want it sooner.

## Done and verified

### v0.16 (released in 0.17.0)
- **Plan readings saved** in the index DB:
  - table `plan_readings`, 90 days;
  - kept across schema bumps;
  - the last 5 hours are read back on start for the pace forecast.
- **Calibration** (`shared/planCost.ts`):
  - pairs of readings of the same window, matched with the API-priced $ logged in between, give "share of the window per $";
  - moves with no local usage nearby (claude.ai, phone) are left out as `outside`;
  - needs ≥ $2 of usage and a 2-point move (5 points for the session window).
- **Verified:** sample readings planted at a known rate (from real costs) came back exact: 0.00400 vs 0.004. Real polls save rows.
- **Where it shows:** `PlanShare` "≈0.4% wk" on chats, project Overview, tasks, vault builds and Usage rows. The Usage card "What things cost on your plan" has the Eco check: cost per reply in Eco chats vs the others, once both sides have 30 replies (store `ecoSessions`).
- **Inbox** (`renderer/src/inbox.ts`, pure and tested; `InboxView.tsx`; `Ctrl+Alt+I`):
  - worked out from live state;
  - dismissals in `UiState.inboxDismissed`, with keys that change when something new happens;
  - sidebar badge.
- **Daily digest** (`main/digest.ts`, `shared/digest.ts`): on the Inbox page and as a notification at `settings.digestTime` (default 09:00).

### v0.17 (released)
- **Agents** (`AgentsView.tsx`, `agents.css`):
  - minimize to a dock (`Ctrl+Shift+Down`);
  - maximize to fill the window (`Ctrl+Shift+Up` or double-click the header); hides sidebar, top bar and status bar via `.app.agent-maximized`;
  - drag grid dividers (6px gutter tracks, sizes per shape in localStorage `mc.agentSizes`);
  - columns Auto/1–4.
- **Chats tab "Open as agents"** (2/4/8/all, asks above 8). Resuming a chat that's already open focuses its agent (in App `launch`).
- **Recap** (`shared/recap.ts` builder, `main/recap.ts` streams the transcript):
  - card in the chat viewer, plus a "Last time:" banner on resumed agents (`Agent.resumedFrom`);
  - **Summarize with Claude** and **Name chats** use a one-shot `claude -p --model haiku --no-session-persistence --tools "" --strict-mcp-config` (about $0.0003/call, no chat file created);
  - results in store `chatRecaps` / `chatAiNames`.
- **Names:**
  - title order: MC rename > Claude name > Claude Code `custom-title`/`ai-title`/`agent-name` > first prompt;
  - better `titleFromPrompt`;
  - `unclearTitle()` decides what Name chats offers;
  - dates on duplicate titles;
  - index schema 8.
- **Update button** (`TopBar.tsx` `UpdateButton`, `updater.ts` `updateNow`): checks every 30 minutes and on window focus (at most every 10 minutes).

### v0.18 (not released)
- **Quit hang: root cause found and fixed.**
  - Cause: node-pty's Windows `kill()` stops reading output, then calls `ClosePseudoConsole` synchronously. ConPTY waits for the console host to flush output nobody reads, so it waits forever while the program prints. This could also freeze the app when closing one busy agent.
  - Proof: the stuck process sat at 0% CPU, and its leftover child was `conhost --headless --width 100 --height 20`, the test terminal's size. Stopping that conhost released it.
  - Fix: **terminals run in `src/main/ptyHost.ts` as an Electron `utilityProcess`**. Closing a terminal there means stop its program tree (`taskkill /T /F`), let node-pty drain, then close the console. On quit, main stops all programs, then `host.kill()`.
  - `pty.ts` keeps the same functions.
  - **Verified:** old code hung on the first stress run. With the host, the app's exit takes under 100 ms with 8 flooding terminals and 0 shells are left. `claude --version` through the host, the hook replay and the agents tour all pass.
- **Workspaces:**
  - store `workspaces`, IPC `workspaces:list/save/delete`;
  - `WorkspacesDialog.tsx`; Agents bar menu, palette and empty Agents page;
  - grid columns lifted to App (`agentCols`);
  - reopen resumes chats and skips agents already open (chats by session, shells by title + folder; the shell rule was fixed after the test found a duplicate).
- **Send to…** (`BroadcastDialog.tsx`, `Ctrl+Shift+A`):
  - presets: briefing with a per-agent file, Where are you?, Wrap up, /compact;
  - multi-line prompts go in as a bracketed paste (`shared/terminalInput.ts`).
  - **Verified with a real Haiku agent:** it replied "pong", checked in the chat file. The workspace saved (4 agents, grid), reopened with the chat resumed, and deleted.
- **Self-tests run in their own profile**, `%APPDATA%\Mission Control (self-test)`, starting from a copy of `store.json`.
- New tests: `MC_SMOKE_QUIT=<n>` (quit stages timed) and `MC_SMOKE_WS=<folder>`.
- **Docs:** ADR `0018-terminal-host-workspaces-broadcast.md`; README (v0.18), ROADMAP (v0.18), ARCHITECTURE and DEVELOPMENT updated.

## Decisions and why
- **Plan cost uses API-priced $ as the yardstick:** it already weighs models and cache reads; raw tokens are about 99% cache reads. Tokens per 1% for each model are derived, not regressed (too noisy).
- **Inbox is worked out from live state, with no event log:** items clear themselves, and there's nothing to keep in sync.
- **Claude Code's `custom-title` counts as Claude Code's, not the user's:** it writes its automatic names that way (20 of 24 "bot" chats).
- **Terminal host instead of patching node-pty:** in-process fixes still hit the native wait. node-pty's bundled newer ConPTY (`useConptyDll`) hung on spawn, so it was reverted.

## Open problems
- **The final OS teardown of a dev Electron process takes 30–90 s even with zero terminals** on this machine. It's below the app: JS exit is under 100 ms and the window closes at once. Not investigated further; possibly antivirus or the earlier stuck copies.
- `utilityProcess` + node-pty from inside **app.asar has not been tested in a packaged build yet.** Must check before releasing (see next steps).
- Not tried for real: the morning digest notification firing, and the Eco check, which needs 30 replies in Eco chats.
- Plan-cost shares show only after about a day or two of saved readings.
- The GitHub MCP server fails (bad auth header); the `gh` CLI works and is what releases use.

## Exact next steps
1. Wait for the full test. Summary: `C:\Users\bsbra\AppData\Local\Temp\claude\C--Users-bsbra-Desktop-claude-hub\0d4546f3-5d52-4e77-98e4-3624d3fab1d1\scratchpad\full\out\summary.txt`; logs `*.log` and screenshots in the same folder. Grep the logs for `FAILED|UNCAUGHT`, and read batch 4 (tasks, UI merge), batch 5 (automation, chains, AI names) and batch 6 (quit stages).
2. **Packaged check** before releasing:
   1. Run `npx electron-builder --win --dir`.
   2. Run the self-test on `release\win-unpacked\Mission Control.exe` with `MC_SMOKE`, `MC_SMOKE_LOG` and `MC_SMOKE_WS=<folder>`.
   3. Confirm terminals start (the pty host from asar).
3. Bump to **0.18.0**, commit, push, then `node scripts/release.mjs "<notes>"`, then `git tag v0.18.0 && git push origin v0.18.0`. The user's 0.17 app shows the Update button within 30 minutes or on focus.
4. Tell the user the test results and costs: batches 3–5 use about $0.40 of Haiku.

## Gotchas
- **Git Bash heredocs** with backticks, `${}` or backslashes break. Write `.cjs` patch scripts to the scratchpad with the Write tool and run them with `node`, or use the Edit tool. Quoted `<<'EOF'` heredocs mostly work; `\n` inside a `node -e` string becomes a real newline.
- **Never run a smoke test while a stuck dev copy is alive.** It shares nothing now (own profile), but check `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` first. Stuck copies clear with `Stop-Process` (the agent may stop its own test processes). `taskkill /T /F` on them was denied by the permission classifier.
- `Start-Process … ; WaitForExit()` can report "not exited" because of the slow OS teardown above. Judge by the `quit stage: process exit` log line.
- **Release steps:**
  1. Bump `package.json` with node (PowerShell `Set-Content` adds a BOM).
  2. Commit and push.
  3. `node scripts/release.mjs "<notes>"`
  4. `git tag vX && git push origin vX`
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only when asked; the user's "you do it" about the update counted as permission to release.
- `~/.claude` is read-only for the app. Session JSONL can be 30+ MB, so stream it; never read a whole file to list chats.
- Electron `sendInputEvent` drags need `modifiers: ['leftbuttondown']` on mouseMove. Grab grid gutters away from their midpoint, where a row gutter crosses.

## Files that matter
- **Terminals:** `src/main/ptyHost.ts`, `src/main/pty.ts`; quit handlers at the bottom of `src/main/index.ts`.
- **Workspaces / Send to:** `src/renderer/src/components/WorkspacesDialog.tsx`, `BroadcastDialog.tsx`, `src/shared/terminalInput.ts`; App `openWorkspace` / `saveWorkspace`.
- **Agents UI:** `src/renderer/src/components/AgentsView.tsx`, `src/renderer/src/agents.css`.
- **Recaps / names:** `src/shared/recap.ts`, `src/main/recap.ts`, `SessionRecap.tsx`, `src/main/claudeData.ts` (`summarizeSession`, `withOwnTitle`), `src/shared/projectLook.ts` (`titleFromPrompt`, `unclearTitle`).
- **Plan cost / inbox / digest:** `src/shared/planCost.ts`, `src/main/planCost.ts`, `src/renderer/src/planRate.tsx`, `src/renderer/src/inbox.ts`, `InboxView.tsx`, `src/main/digest.ts`, `src/shared/digest.ts`; `src/main/indexWorker.ts` (`plan_readings`, schema 8).
- **Updates:** `src/main/updater.ts`, `TopBar.tsx`.
- **Self-tests:** `src/main/smoke.ts` (tours: QUIT, WS, AGENTS, INBOX and the older ones).
- **Decisions:** `docs/decisions/0016-plan-cost-and-inbox.md`, `0017-agent-layout-recaps-and-chat-names.md`, `0018-terminal-host-workspaces-broadcast.md`.
