# Architecture

Mission Control is an Electron app with three parts, built by `electron-vite`.

```
src/
  main/        Node side: file access, PTYs, IPC handlers
    index.ts       window + IPC registration
    claudeData.ts  reads ~/.claude/projects (projects, sessions, chat transcripts); folds worktree chats into their project
    pty.ts         spawns claude / PowerShell in pseudo-terminals (ConPTY)
    store.ts       the app's own JSON store (pins, added folders, open agents, UI state, window bounds)
    hookServer.ts  local HTTP endpoint that receives Claude Code hook calls
    git.ts         git status, worktrees, diffs, commit, merge (runs the git CLI)
    indexer.ts     starts the index worker and relays queries to it
    indexWorker.ts worker thread: SQLite full-text index + token usage of every chat
    pricing.ts     API list prices per model, for cost estimates
    tasks.ts       task board data + headless runner (claude -p, stream-json)
    tray.ts        tray icon, tray menu, global show/hide hotkey
    templates.ts   task templates, {{variables}}, scheduler for recurring templates
    updater.ts     auto-update via electron-updater (public releases repo)
    spend.ts       live chat size, startup report, MCP servers per project, extra launch args (model, --strict-mcp-config)
    smoke.ts       self-test run with MC_SMOKE=<png path>
  preload/     exposes a typed `window.mc` API to the UI (contextIsolation on)
  shared/      types used by both sides (MissionControlApi lives here)
    projectLook.ts  README title/description, icon guess, worktree paths, chat titles (pure, unit-tested)
  renderer/    React UI
    src/App.tsx              app state: projects, git info, agents, views, command palette
    src/terminalBus.ts       routes PTY output to the right terminal pane
    src/agentStatus.ts       hook event -> agent status, and what each status looks like
    src/toast.tsx            in-app messages (useToast)
    src/projectLook.tsx      icon components and LookContext: any project path or name -> name, icon, color
    src/shortcuts.ts         every keyboard shortcut, key matching, terminal-safe rules, rebinding (ADR 0010)
    src/components/
      ui.tsx                 shared building blocks: Button, IconButton, Avatar, MenuButton, Segmented, EmptyState
      Sidebar, HomeView, ProjectView, OverviewPanel, SessionViewer, DocsPanel
      AgentsView, TerminalPane, ChangesPanel, DiffView, CommandPalette, StatusBar
      SearchView, UsageView, TasksView, TaskComposer, TaskDrawer, SettingsDialog, IdentityDialog, ShortcutsDialog, SpendingCard
    src/organize.css         styles for groups, tags, overview, search and usage
    src/tasks.css            styles for the task board, dialogs, task drawer, meters
```

## Project names and worktree chats

`listProjects` reads each `~/.claude/projects` folder's working directory from its newest chat. A folder whose directory is inside `<project>\.claude\worktrees\` is added to that project's `keys` instead of becoming a project of its own. `listSessions`, search and per-chat usage take all of a project's `keys`. `describe()` fills in each project's name, description, icon and color (see decision 0008). The UI looks these up through `LookContext`, so a task or agent that stored an older name or a worktree path still shows the right icon.

## Tasks

Tasks live in `store.json` (`tasks`). `tasks.ts` in the main process owns them: it keeps them in memory, pushes every change to the UI (`tasks:changed`, throttled), and saves them to the store (debounced, written atomically).

**Headless run.** `startTask` prepares the folder (a new worktree when the task asks for one) and spawns:

```
claude -p --output-format stream-json --verbose --session-id <uuid> --permission-mode <mode> [--max-budget-usd N] [--model M]
```

The prompt goes in on **stdin**, so no shell quoting is involved, and the process runs with `agentEnv()`. Each JSON line updates the run:

| Event | Effect on the card |
|---|---|
| `system/init` | session id, model |
| `assistant` → `tool_use` | tool count +1, activity like "Editing app.ts" or "Running: npm test" |
| `assistant` → `text` | activity becomes the first line of the text |
| `rate_limit_event` | plan meters (5-hour and 7-day utilization) |
| `result` | cost (`total_cost_usd`), turns, final answer, or error |

When the process exits, the task moves to **Review**, whether it succeeded, failed or was stopped (the card says which), and a Windows notification fires if the window isn't focused. **Stop** kills the whole process tree (`taskkill /T`). Runs don't survive an app restart; on startup, unfinished runs are marked "Stopped when Mission Control closed" and moved to Review, where **Continue in terminal** resumes the session (`--resume <id>`).

**Interactive run.** The main process prepares the folder and returns the launch arguments (the prompt is claude's first message). The UI opens a normal agent and links it to the task (`run.agentId`). The card mirrors that agent's hook status, and closing the agent moves the task to Review.

## Templates, schedules and the queue

- **Templates** (`store.templates`) hold everything a task needs except, optionally, the project. `runTemplate` fills `{{project}}`, `{{date}}`, `{{time}}` and `{{weekday}}`, creates the task, then starts it, queues it, or leaves it in To do.
- **Scheduler:** `templates.ts` ticks every 30 seconds. A template whose `nextRunAt` has passed runs **once**, even if several occurrences were missed while the app was closed, and then gets its next time computed from now (`nextRunAfter`: hourly / daily / weekdays / weekly). A fired interactive task asks the UI to open its agent (`task:launch`). Self-tests connect the UI but never run the timer.
- **Auto-queue:** headless To do tasks with `queued: true` run in board order. `pumpQueue()` runs after every finish, on queue or setting changes, and every 30 seconds. It starts tasks while fewer than `queueParallel` headless runs are active, and holds while the queue is off or a plan window is at or above `queuePauseAtPercent`. A queued task that can't start (for example its worktree can't be created) goes to Review with the error.

## Chains, checks and guardrails (v0.7)

- **Dependencies** live on the task (`dependsOn`, `whenReady`). The rules are pure functions in `src/shared/deps.ts`, used by both the main process and the UI and covered by unit tests. "Succeeded" means finished without an error **and** checks (if any) passed. A failed dependency leaves dependents blocked. Loops are rejected when a task is created.
- **After a headless run succeeds** (`tasks.ts → afterSuccess`):
  1. In a worktree, everything is committed (`commitIfDirty`).
  2. The project's `checkCommand` runs in PowerShell in the task's folder, with a 10-minute limit; exit code 0 means passed.
  3. The task moves to Review.
  4. `onTaskSettled` starts dependents that are now ready (subject to guardrails).
- **Branch chaining:** `chainBaseFor` picks the most recently finished successful worktree dependency. The new worktree branches from it but keeps the original `base`, so merging the last step merges the whole chain.
- **Follow-up** resumes the run's session (`claude -p --resume <id>`). The cost so far is kept in `run.costBefore`, and the stream parser adds the new cost to it.
- **Guardrails** (`automationHold`): plan usage at or above `queuePauseAtPercent`, or the project over its `monthlyBudgetUsd`, holds the queue, recurring tasks (that run is skipped, not the schedule) and chain auto-starts. Monthly spend comes from the chat index, including the project's worktrees (`budget.ts`). A warning fires once per month at 80%. Tasks you start yourself are never blocked.
- **Turn on git** (`git.ts`): `previewGitInit` lists what would be committed using a throwaway git directory in the temp folder (the project folder isn't touched). `initGit` merges `DEFAULT_GITIGNORE` into `.gitignore`, runs `git init -b main`, sets a repo-local identity only if none is configured (from the GitHub CLI account, as a noreply address), and commits.
- **Tests:** pure logic (`src/shared/*.ts`, `streamParser.ts`, `pricing.ts`, `renderer/src/diff.ts`) has Vitest unit tests. CI (`.github/workflows/ci.yml`) type-checks, tests and builds on Windows.

## Updates

`updater.ts` wraps electron-updater. Packaged builds check `Brawly0/mission-control-releases` 15 seconds after start and every 6 hours (setting `autoUpdate`), download in the background, and install on the next restart or right away from **Update ready · Restart**. See ADR 0006 for why releases live in a separate public repo.

## Tray, hotkey, close to tray

- `tray.ts` creates the tray icon (status tooltip; right-click menu: New task, Task board, Agents, Quit) and registers the global hotkey from `settings.hotkey` (default `Ctrl+Alt+M`, which toggles the window).
- Closing the window while terminals or headless tasks run hides it instead (with `settings.closeToTray`, on by default) and says so once in a notification. Quit from the tray menu stops everything.
- `app.requestSingleInstanceLock()` makes a second launch (for example the desktop shortcut) bring the existing window back instead of starting a second copy.

## Search and usage index

`indexWorker.ts` runs in a worker thread so indexing never blocks the window or terminals. It uses Node's built-in `node:sqlite` (FTS5 is compiled in), so no native module is needed. The database is `%APPDATA%\Mission Control\index.db` and is safe to delete; it rebuilds in seconds.

| Table | Contents |
|---|---|
| `fts` | FTS5 index of human prompts and Claude's text replies (not tool calls or results), with role and time |
| `msgs` | one row per assistant API message: model, day, token counts, estimated cost |
| `sessions` | title (custom title, else the first prompt), project, start and update time |
| `files` | for each `.jsonl`: size, mtime and the byte offset read so far |

- **Incremental:** transcripts are append-only, so only bytes after the stored offset are read. A partly written last line waits for the next pass. If a file shrinks, its session is re-indexed from scratch. A full pass runs at startup and every 60 seconds; a pass with no changes takes about 15 ms.
- **Usage dedupe:** a streamed reply repeats the same `message.id` on several lines, so each message keeps the largest count seen for each field.
- **Subagents:** `<session>/subagents/*.jsonl` add usage to their parent chat but aren't searchable.
- **Cost:** `pricing.ts` maps model ids to API list prices. Cache writes are 1.25× input (5-minute) or 2× (1-hour), and cache reads 0.1× input unless the model lists its own rate. It's an estimate of API-equivalent spend, not what a subscription costs.
- **Search query:** user input is reduced to words. Each becomes a quoted FTS term (so no FTS syntax errors), and the last word also matches as a prefix. Results are ranked by `bm25` and grouped by chat in the UI.

## Project organization

Group, tags, status and notes live in `store.json` under `projectMeta`, keyed by lower-cased path, and arrive on each `Project` as `meta`. The sidebar shows groups as collapsible sections (Pinned first, then groups A to Z, then Other), tags as AND filter chips, and sinks `done` projects to the bottom of their section.

## UI

Five views share one window: **Home** (dashboard), **Project** (Overview / Chats / Changes / Docs tabs), **Agents** (terminals in tabs or a grid, with an optional review panel), **Search** and **Usage**. All stay mounted and are hidden with `visibility`, so terminals keep running and keep their scrollback when you switch.

- Icons come from `lucide-react`. Colors, radii and fonts are CSS variables at the top of `styles.css`; the accent is Claude's terracotta `#d97757`.
- Grid cells use container queries to drop detail (branch chip, timer, status text) when they get narrow.
- Selected project, view, layout and the worktree toggle are saved through `ui:set`; window bounds are saved by the main process on close.

## Worktrees

"New session in worktree" calls `git.createWorktree`, which:

1. Creates branch `mc/agent-xxxx` from the main checkout's current branch.
2. Adds a worktree at `<repo>/.claude/worktrees/agent-xxxx`, where Claude Code keeps its own worktrees.
3. Adds `.claude/worktrees/` to `.git/info/exclude`, a local file that's never committed, so the main checkout stays clean.

The agent runs with that folder as its working directory. **Review** shows `git diff <merge-base>` plus untracked files.

- **Merge** refuses if the worktree has uncommitted changes, if the main checkout is on a different branch, or if the main checkout is dirty. Otherwise it runs `git merge --no-ff`.
- **Discard** asks for confirmation in a native dialog in the main process. It then stops every terminal whose working folder is inside the worktree (Windows locks a folder that is in use) and runs `git worktree remove --force` and `git branch -D`, retrying briefly while Windows releases the folder. It only ever touches `mc/` branches under `.claude/worktrees/`.

## Data sources

| Data | Where it comes from |
|---|---|
| Projects | Each folder in `~/.claude/projects/`. The real path is read from the `cwd` field inside a session file, because the folder name encoding is lossy. |
| Sessions | Each `*.jsonl` in a project folder. Files can be 30+ MB, so listings read only the first 256 KB (first prompt, cwd, branch) and the last 128 KB (`custom-title` entries). Results are cached by file mtime. |
| Chat transcript | Streamed line by line. Only human prompts and assistant text are kept; tool calls, tool results, sidechains and meta entries are skipped. Capped at the latest 600 messages. |
| Pins, added folders, open agents | `%APPDATA%\Mission Control\store.json` |

Claude Code's files are **read-only** to this app. The JSONL format is undocumented and may change, so parsing is defensive: unknown lines are skipped.

## Terminals

`@lydell/node-pty` (prebuilt binaries, no compiler needed) runs each agent in a Windows ConPTY. `claude` is found on `PATH` (`.cmd` shims go through `cmd.exe /c`). The renderer shows it with `xterm.js`.

- Output flows `main → 'pty:data' IPC → terminalBus → TerminalPane`. Output that arrives before the pane mounts is buffered.
- Panes stay mounted when you switch views or tabs (hidden with `visibility`) so scrollback and running processes survive.
- Plain shells have no hooks, so their status light falls back to output timing (`agentStatus.ts`, `WORKING_MS`).

## Agent status via hooks

Every `claude` the app starts gets `--settings <userData>/hooks/<agentId>.json`. That file adds hooks for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop` and `SessionEnd`, each running:

```
curl.exe -s -m 3 -X POST --data-binary "@-" http://127.0.0.1:<port>/hook/<agentId>/<token>
```

curl forwards the hook's JSON input to `hookServer.ts`, which sends it to the renderer as `hook:event`. `agentStatus.ts` turns it into a status:

| Hook | Status | Notifies |
|---|---|---|
| SessionStart | ready | no |
| UserPromptSubmit, PostToolUse | working | no |
| Notification (permission) | needs you | yes |
| Stop | done | yes |

- The user's own `~/.claude/settings.json` is never touched. `--settings` only adds to it for that one process.
- If Mission Control was started from inside a Claude Code session, that session's `CLAUDECODE` / `CLAUDE_CODE_*` / `ANTHROPIC_BASE_URL` variables are stripped from agents (`agentEnv()` in `pty.ts`), so agents use your own CLI login.
- The port is random and the URL carries a per-run secret, so other local processes can't post fake events.
- Settings files are deleted when an agent exits and cleared at every startup.

## Restoring agents

New claude sessions are started with `--session-id <uuid>` chosen by the app, so the app always knows which transcript an agent belongs to. `SessionStart` updates the id if it changes (for example after `/clear`). The open agents are saved to the store whenever they change. Saving stops during quit, so the exits that happen on shutdown don't wipe the list. On the next start, a banner offers to restore them: claude agents reopen with `--resume <id>`, or start fresh if that session never got a prompt.

## IPC surface

All channels are listed in `src/preload/index.ts` and typed by `MissionControlApi` in `src/shared/types.ts`. Add new features by extending the interface, the preload and an `ipcMain` handler, in that order.
