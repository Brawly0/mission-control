# Development

## Setup

```bash
npm install
npm run dev
```

`npm install` runs a `postinstall` step that downloads the Electron binary. If `npm run dev` says Electron failed to install, run:

```bash
node node_modules/electron/install.js
```

## Checks

```bash
npm run typecheck
npm run build
```

### Smoke test

Builds aside, the app has a self-test that scans your projects, runs `claude --version` in a real PTY, screenshots the window and quits:

```powershell
npm run build
$env:MC_SMOKE = "$PWD\smoke.png"; .\node_modules\electron\dist\electron.exe .
```

Expected output: `[smoke] projects: N`, the session count of one project, the Claude Code version from the PTY, and the screenshot path.

## Conventions

- TypeScript strict everywhere. Shared types live in `src/shared/types.ts`.
- Never write to `~/.claude`. App data goes in `store.ts`.
- New IPC: add to `MissionControlApi`, then `preload/index.ts`, then a handler in `main/ipc.ts`.
- Styles: plain CSS with variables in `renderer/src/styles.css`. No UI framework.
- Record significant choices in `docs/decisions/NNNN-title.md`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Terminal says "claude was not found on PATH" | Install Claude Code, check `where claude`, restart the app |
| A project shows a strange path | The real path is read from session files. Folders with no readable session fall back to decoding the folder name, which is lossy. |
| Agents fail with "OAuth session expired" | Log the CLI in with `claude auth login` in a normal terminal; `claude auth status` should show `"loggedIn": true`. The desktop app's login is separate. |
| Chat list is slow the first time | Large session files are scanned once, then cached by modification time |
| A headless task stops right away with a permission message | The task's permission mode refused an action. Pick "Auto" or "Accept edits", or run it Interactive to approve things yourself. |

### Hook test

`MC_SMOKE_HOOKS=<empty folder>` makes the smoke test also send one tiny real prompt (`claude -p`) from that folder and list the hook events that reached the app. Expected: `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`, all with the session id the app assigned. This uses a small amount of your Claude usage and needs `claude` to be logged in. Set `MC_SMOKE_MODEL=haiku` to use a cheaper model.

### Codex test

`MC_SMOKE_CODEX=<scratch git repo with a CLAUDE.md>` opens a Codex agent there with a short read-only prompt and checks: the status lights (working, then done), the chat id the app finds, the chat in the project's list, its recap, Codex usage and limits, the chat viewer, and the agent's **→ Claude** button (it writes the handoff and starts Claude). Screenshots `<MC_SMOKE>-codex-*.png`. Uses one short Codex turn and starts one Claude agent. The folder is trusted for that run only (`-c projects=…`), so nothing is saved to `~/.codex`. Claude will show its own "trust this folder" screen for a new scratch folder; that's expected.

### Projects and connections test

`MC_SMOKE_WORKSPACE=1` checks the sidebar's agent connections (both checked, via `claude` and `codex login status`), renaming a project from its right-click menu, drag-sorting on the Projects page and in the sidebar (both saved), and the Agents bar's **Terminal** button (PowerShell in the active agent's folder). It needs the claude-hub project in your project list and puts the project names and order back afterwards. Screenshots `<MC_SMOKE>-connections/project-menu/projects/sidebar-rename/terminal.png`. No model calls.

### UI tour and worktree test

`MC_SMOKE_UI=<git repo with at least one commit>` screenshots Home, the project tabs, the command palette and the Agents grid with the review panel (as `<MC_SMOKE>-<name>.png`). It also runs the worktree flow on that repo: create, change a file, commit, merge into the base branch, stop the agent, delete. Use a throwaway repo, because the test merges into it. The repo is shown as a project only while the test runs.

## Packaging

`npm run dist` builds `release/Mission Control Setup <version>.exe` with electron-builder (NSIS, one-click, per-user). The app icon is `build/icon.svg`; run `npm run icon` after editing it to regenerate `build/icon.png`, which electron-builder turns into the `.ico`.

To test a packaged build without installing it, use the smoke test on `release/win-unpacked/Mission Control.exe`. A packaged Windows app has no console, so set `MC_SMOKE_LOG=<file>` to get the log:

```powershell
$env:MC_SMOKE = "$PWD\smoke.png"; $env:MC_SMOKE_LOG = "$PWD\smoke.log"
& ".\release\win-unpacked\Mission Control.exe"; Get-Content smoke.log
```

### Task test

`MC_SMOKE_TASKS=<git repo with a commit>` runs one real headless task (Haiku, in a worktree, $0.20 budget) through the board. It checks the activity, cost and result, confirms the file it wrote in the worktree, screenshots the board, the task panel and the New task dialog, then deletes the task and its worktree. A run costs about $0.03.

## Releasing an update

Installed copies update from the public repo [Brawly0/mission-control-releases](https://github.com/Brawly0/mission-control-releases). It holds only installers; the source stays in this private repo.

1. Bump `version` in `package.json` (for example 0.6.0 → 0.6.1). Auto-update only offers a higher version.
2. Publish (uses your `gh` login for this run only):

   ```powershell
   npm run publish-release -- "What changed in this version"
   ```

   `scripts/release.mjs` creates a **draft** release `v<version>` first, then builds and uploads the installer, its `.blockmap` and `latest.yml` into it. It checks that all three files are there before publishing the draft as the latest release. Creating the draft up front matters: electron-builder uploads files in parallel, and on an empty draft each upload can create its own release.
3. Running copies notice within 6 hours (or at their next start, or with **Settings → Check now**). They download in the background and show **Update ready · Restart** in the status bar.

`MC_SMOKE_UPDATE=1` on a packaged build checks the releases repo and downloads (but doesn't install) any newer version, logging each step.

### Automation test

`MC_SMOKE_AUTOMATION=<git repo with a commit>` checks the schedule math and template variables, fires an overdue recurring template, and runs two real queued Haiku tasks with one slot (about $0.05), which must run one after the other. It restores your queue settings and deletes everything it created.

### Unit tests and CI

`npm test` runs the Vitest unit tests for pure logic: schedule math, dependency rules, the stream parser, pricing and the diff parser. They're free and take under a second. GitHub Actions (`.github/workflows/ci.yml`) runs type-check, unit tests and build on Windows for every push. Keep new logic testable by putting it in Electron-free modules (`src/shared/`, or main-process files that don't import `electron`).

### Chain test

`MC_SMOKE_CHAIN=<empty scratch folder>` runs the v0.7 flow end to end in that folder (about $0.10 of Haiku):
1. Turn on git, with a `.env` and `node_modules` that must stay out.
2. A 3-step chain whose first check fails, so the next step must stay blocked.
3. Fix the check and re-run it, so the chain continues by itself on chained branches.
4. A follow-up, then merging the last branch.
5. The monthly budget guard holding a queued task.

Everything it creates is removed, and your settings are restored.

`MC_SMOKE_NAMES=<project folder name, e.g. WBP>` logs every project's name, icon and chat count, lists that project's chats (with worktree labels), renames one chat and puts it back, and screenshots the chats and the Name and icon dialog. Free.

`MC_SMOKE_SPEND=<empty scratch folder>` checks v0.9 against your real data, for free:
1. It reads the size of the busiest project's latest chats and builds its startup report.
2. It lists chats over $1 today.
3. It limits the scratch folder to one MCP server with Haiku as its default model, then starts Claude there and reads its init event. Only that server and Haiku must appear. The process is stopped before any request goes out.
4. It screenshots the Spending card, and the size meter on a resumed test chat.

Settings are restored afterwards.

`MC_SMOKE_SHOTS=<project folder name, e.g. bot>` screenshots every screen: Home, that project's tabs, Tasks, Agents, Usage, Search, the palette, Settings and the shortcuts list. It then presses real shortcuts and checks each one: `Ctrl+1/2/3/5`, `Ctrl+Shift+F`, `Ctrl+/` and `Ctrl+B`. Last, it switches to the light theme with `Ctrl+Shift+L`, screenshots it, and puts your theme back. Free. Use it for before/after comparisons of UI changes.

`MC_SMOKE_HUB=<empty scratch folder>` checks the v0.11 pieces, for free:
- Notes: save, pin and delete.
- Knowledge: the doc list, and a search.
- New project: creates one with CLAUDE.md and git.
- Quick chat: the folder must be hidden as scratch.
- Due dates: a reminder must fire exactly once.
- Claude Code status and the greeting name.

It removes what it created.

`MC_SMOKE_SKILLS=1` checks the Skills page and Eco mode against your real skills and chats, for free:
- Lists the skills by source and the skill uses from the index.
- Turns Eco mode on for the tour (restored afterwards) and logs the launch flags.
- Asks the coach about your largest recent chat through the hook server (a real `UserPromptSubmit` round trip), then again directly, which must return nothing new.
- Screenshots the Skills page, eco:coach's detail and Settings → Spending.

`MC_SMOKE_VAULT=<empty scratch folder>` writes a sample vault there (INDEX, linked notes, a decision, a briefing), shows it as a project for the tour, and checks link resolution, backlinks, the live watcher (a new file appears), the graph, and the empty "Build vault" screen and its dialog (cancelled). It screenshots each as `<MC_SMOKE>-vault-*.png`. Free: nothing is sent to Claude.

Self-tests run in their own profile, `%APPDATA%\Mission Control (self-test)`, starting from a copy of your settings, so they work while the installed app is open and never change its data.

`MC_SMOKE_QUIT=<n>` runs only the quit test: n terminals printing as fast as they can, then the window closes. It logs the time of each quit stage (it should reach `process exit` in well under a second). The old in-process terminals hung here on the first try (ADR 0018).

`MC_SMOKE_PERF=1` runs only the speed test, for free. It logs startup times in ms since the process started (main loaded, ready, window created, page loaded, first project shown), how long the project list and git info take, then idle CPU and memory per process with no agents and with 4 shell agents, plus any endless animation still running. `MC_SMOKE_PERF=startup` stops after the startup part. `MC_SMOKE_PERF=fresh` first deletes the test's own index, to time a full build. Single runs are noisy: compare several runs, alternating old and new builds (ADR 0019).

`MC_SMOKE_WS=<empty scratch folder>` checks workspaces and Send to… (about $0.001 of Haiku):
- Opens two PowerShell agents and one real Claude agent (Haiku) and saves them as a workspace through the dialog.
- Sends "pong" with Send to… and checks the reply in the chat file.
- Closes everything, then reopens the workspace (the chat must be resumed, in the grid) and deletes it.

`MC_SMOKE_AGENTS=<project folder name, e.g. bot>` checks v0.17 for free:
- Logs the project's chat names (and where each comes from) and the recap of its newest chat, and screenshots the Chats tab with the recap card.
- Opens four agents "resumed" from the newest chats. They're PowerShell tabs, so nothing runs in Claude and no chat file is touched.
- Shows them in the grid and checks the "Last time" banners. Drags a divider with the real mouse, then minimizes one agent and maximizes another.
- Screenshots each step as `<MC_SMOKE>-agents-*.png` and clears the grid sizes it saved.

Add `MC_SMOKE_AGENTS_AI=1` to also run Summarize and Name chats for real (Haiku, about $0.005). It logs the old and new names, then puts the store back as it was.

`MC_SMOKE_INBOX=1` checks plan cost and the inbox, for free. It writes three days of sample plan readings into the self-test's own index, made from your real chat costs at a known rate (1% of the week per $2.50), and checks the calibration finds that rate again. It adds a finished, a failed and an overdue task, then checks the inbox items, the sidebar badge, dismissing, both digests and the plan shares on Usage and Tasks. It screenshots the Inbox, Usage, Tasks and Settings → General as `<MC_SMOKE>-inbox-*.png`. The tasks and sample readings are removed afterwards.

`MC_SMOKE_PLAN=1` asks your Claude account for your plan limits (one small request, no model use), logs the windows and plan, checks the top-bar meter text and screenshots Home and Usage. Free. (Normal smoke runs don't poll.)

`MC_SMOKE_BRIEF=<empty scratch folder>` lists the session briefings (compaction summaries) in your chats. It writes the newest one as a file into the scratch folder (never into your projects), checks the wrapper lines are gone and that "latest briefing" finds it, and screenshots Knowledge → Session briefings. Free.
