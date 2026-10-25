# Session briefing: v0.19 "make it solid", step 1 (Oct 25, 2026)

Mission Control is a Windows Electron + React + TypeScript app that manages Claude Code projects, chats, agents and tasks. Repo `C:\Users\bsbra\Desktop\claude-hub` (private `Brawly0/claude-hub`). Releases go to `Brawly0/mission-control-releases`; installed copies update from there.

## Goal
The user decided to **stop adding features and work on the app itself**. Agreed plan for v0.19, done one step at a time:
1. **Real-use walkthrough:** fix bugs, confusing labels and rough edges. ← **done this session**
2. Speed and resource use: startup time, idle CPU and memory, indexing cost, the 2.2 MB renderer bundle.
3. Code cleanup with no behaviour change: split `App.tsx` (1,348 lines, 74 hooks), trim `main/index.ts`.
4. UI simplification: merge, hide or remove clutter in the sidebar, top bar and settings.
5. Known-issues backlog.

Agreed order: **1 → 3 → 2 → 4**, then 5.

## State at hand-off
- **v0.18.0** is released (`92d6d47`), tested by an earlier agent, and installed on the user's machine.
- **Step 1 fixes are NOT committed.** At the end I asked "commit first?" and got no answer yet. Commit only when the user says so.
- Typecheck clean · **137 unit tests pass** · build OK · `MC_SMOKE_SHOTS=claude-hub` tour passes (all shortcut checks ok).
- The untracked briefings `2026-10-25-0357-…` and this file are also uncommitted.

## Done and verified (step 1)
| # | Problem | Fix | Verified |
|---|---|---|---|
| 1 | `docs/DEVELOPMENT.md` garbled since v0.5 (`bcf61ef`): every line prefixed with `\| Chat list is slow the first time \|` plus a copy of the "headless task" row | Rebuilt from HEAD with a script: dropped junk rows, stripped the prefix, put the headless row back in Troubleshooting | All sections and `MC_SMOKE_*` docs present; no other doc had repeated lines |
| 2 | "Temp" project leaked into the sidebar: 4 copies of the temp regex all needed a trailing `\` | `isScratchPath()` in `src/shared/projectLook.ts`, used in `claudeData.ts`, `HomeView.tsx`, `UsageView.tsx` (`TEMP_PATH` removed) | Unit test; gone from the screenshot |
| 3 | Markdown tables showed as raw text in chats, briefings, task results, notebook and project notes | New `components/Md.tsx` (react-markdown + `remark-gfm`), used in `SessionViewer`, `BriefingsPane`, `TaskDrawer`, `NotebookView`, `OverviewPanel`. Table CSS already existed (`.message-text table`, `.markdown table`) | Typecheck. **Table not yet seen on screen** in the chat viewer |
| 4 | Palette showed "GO TO" twice | `CommandPalette.tsx`: with no query, sort by order of each group's first appearance | Screenshot |
| 5 | Project cards repeated the name as subtitle ("bot / bot") | `ProjectsView.tsx`: subtitle only if there's a description or the folder name differs | Screenshot |
| 6 | Search snippets showed `**`, backticks and `[x](url)` | `Snippet` in `SearchView.tsx` strips them | Typecheck only |
| 7 | Usage → By model showed raw IDs | `label={modelFamily(m.model)}` | Typecheck only. Dated and undated IDs of one model may now show as two rows with the same label |

## Decisions and why
- **Self-test hang = environment, not app.** Bare Electron windows hung at random, with or without the GPU. The cause was memory: commit charge 93%, about 1 GB free. The user's `bot\WBPauto\backend` job `kids.py 1000 5` held about 14 GB across 5 workers, and there were 18 `claude` processes (about 4 GB) plus their MCP servers. After the user paused `kids.py` (71% committed), the tour ran in 46 s instead of hanging. This probably also explains the "slow dev teardown" from the last briefing. **No app change made.**
- **I blamed the GPU first; that was wrong.** `--disable-gpu` passed once by luck. Don't add a software-rendering fallback on that evidence.
- **Left as is:** Home shows "48 total chats", "46 chats this week" and "93 indexed", which count different things; and "1 agent running" for an idle agent. Candidates for step 4 relabelling.
- **Not tested with real use** (they cost plan usage or need waiting; do them with the user): an Eco chat, a real "Build vault with Claude" run, and the morning digest notification.

## Open problems
- Possible duplicate "By model" labels (fix #7): group rows by `modelFamily` if they show.
- The chat-viewer table fix still needs a look on screen.
- 27 `AppData-Local-Temp-…` scratch projects from earlier test runs sit in `~/.claude/projects`. They're hidden from the sidebar, and the app must not delete them (`~/.claude` is read-only for the app). The user could delete them.
- The GitHub MCP server fails with a badly formatted auth header in the user's MCP config. The `gh` CLI works and is what releases use.
- Renderer bundle is a single 2.2 MB chunk (step 2).
- No code signing (SmartScreen warns).

## Exact next steps
1. Ask whether to **commit step 1** (suggested message: `fix: v0.19 polish - markdown tables, scratch folders, palette groups, docs repair`). Commit only on a yes.
2. **Step 3, split `App.tsx`** by area (agents and launch, workspaces, tasks, palette commands, layout state) using the `safe-refactor` approach. Run typecheck, `npx vitest run`, build and the `MC_SMOKE_SHOTS` tour after each cut, with no behaviour change. Then trim `src/main/index.ts` (795 lines; IPC handlers could be grouped by area).
3. Step 2: measure startup (time to `did-finish-load`, time to project list), idle CPU and memory with 4 agents, and index build time. Look at code-splitting the renderer (vault graph, usage charts and xterm are candidates for lazy loading).
4. Step 4: UI simplification proposal; show the user before changing anything.
5. When the steps are done: ROADMAP v0.19 section, an ADR if a notable choice is made, bump to 0.19.0 and release (see Gotchas).

## Gotchas
- **Check memory before any self-test:** `Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory` → `PercentCommittedBytesInUse`. Above about 90%, Electron windows hang at random. Ask the user about `kids.py` and old Claude chats; don't kill their processes.
- **Running the tour:** `$env:MC_SMOKE="<dir>\s.png"; $env:MC_SMOKE_LOG="<dir>\shots.log"; $env:MC_SMOKE_SHOTS="claude-hub"; Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList "."`. Poll the log for `closing window|FAILED|UNCAUGHT`. The self-test only starts after `did-finish-load`. It uses its own profile, `%APPDATA%\Mission Control (self-test)`. Stop leftover test copies with `Stop-Process` on `electron.exe` processes whose command line contains `claude-hub\node_modules\electron`.
- **Debugging a stuck page:** start with `--remote-debugging-port=9333`; scratchpad scripts `cdp.mjs` (evaluate) and `pause.mjs` (stack). If the page doesn't answer and the debugger can't pause it, it's blocked outside JS; check memory first.
- **The clock:** the machine's zone is West Bank Standard Time (+02:00); I once misread a timestamp as 12 hours off. The app's clock is right.
- **Edits:** Git Bash heredocs with backticks break. Use the Edit tool, or `.cjs` scripts in the scratchpad run with `node`. Components here don't annotate return types (`JSX.Element` isn't in scope).
- **Releasing:** bump `package.json` with node (PowerShell `Set-Content` adds a BOM) → commit → push → `node scripts/release.mjs "<notes>"` → `git tag vX && git push origin vX`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never write to `~/.claude/`. Session JSONL can be 30+ MB, so stream it.

## Files that matter
- **Step 1 changes:** `docs/DEVELOPMENT.md`, `src/shared/projectLook.ts` (+ `.test.ts`), `src/main/claudeData.ts`, `src/renderer/src/components/{Md,SessionViewer,BriefingsPane,TaskDrawer,NotebookView,OverviewPanel,CommandPalette,ProjectsView,SearchView,HomeView,UsageView}.tsx`.
- **Step 3 targets:** `src/renderer/src/App.tsx`, `src/main/index.ts`.
- **Self-tests:** `src/main/smoke.ts` (`shotsTour` and the others; trigger at `src/main/index.ts` ~line 757).
- **Context:** `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, ADRs `docs/decisions/0013`–`0018`, previous briefing `docs/briefings/2026-10-25-0357-session-briefing-handoff-review.md`.
