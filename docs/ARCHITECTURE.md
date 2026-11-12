# Architecture

Mission Control is an Electron app with three parts, built by `electron-vite`.

```
src/
  main/        Node side: file access, PTYs, IPC handlers
    index.ts       app lifecycle: startup wiring (hooks, tasks, indexer, tray, scheduler) and shutdown
    window.ts      the main window, showWindow / sendToWindow, the quitting flag
    ipc.ts         every ipcMain handler behind window.mc
    notify.ts      desktop notifications (chat cost, plan limits, digest, due tasks, task results, budgets, briefings)
    terminals.ts   launchTerminal: session ids, hook settings and launch flags for claude terminals; Codex state (OSC 7501) and chat id lookup
    projectCommands.ts saved project commands: PowerShell processes, bounded live output, stop trees and diagnostic reports (ADR 0023)
    projectBriefing.ts editable shared context, recent work snapshots and prompts for both agents
    projectReview.ts checks and agent reviews bound to git snapshots, with freshness validation before merge (ADR 0024)
    codexData.ts   reads ~/.codex (Codex CLI chats): listings, transcripts, recaps, usage and plan limits, finding a new agent's chat (ADR 0020)
    handoff.ts     handoffs between Claude and Codex written to docs/briefings/, and AGENTS.md pointing to CLAUDE.md (ADR 0020)
    docs.ts        listDocs: a project's CLAUDE.md, README, docs/ and .claude/ Markdown
    claudeData.ts  reads ~/.claude/projects (projects, sessions, chat transcripts); folds worktree chats into their project
    pty.ts         spawns claude / PowerShell in pseudo-terminals (ConPTY)
    store.ts       the app's own JSON store (pins, added folders, open agents, UI state, window bounds)
    hookServer.ts  local HTTP endpoint that receives Claude Code hook calls
    git.ts         git status, worktrees, diffs, commit, merge (runs the git CLI)
    indexer.ts     starts the index worker and relays queries to it
    indexWorker.ts worker thread: SQLite full-text index + token usage of every chat
    pricing.ts     API list prices per model, for cost estimates
    tasks.ts       task board data + headless runner (claude -p, stream-json) + live terminal text per run
    tray.ts        tray icon, tray menu, global show/hide hotkey
    templates.ts   task templates, {{variables}}, scheduler for recurring templates
    updater.ts     auto-update via electron-updater (public releases repo)
    briefings.ts   session briefings: saves compaction summaries to docs/briefings/ (ADR 0012)
    hub.ts         notes, Knowledge (docs across projects), Claude Code status, greeting name, quick chats, new projects
    planUsage.ts   plan limits (session / weekly) polled from your Claude account with Claude Code's saved login, read-only (ADR 0013)
    planCost.ts    saves plan readings, caches the plan-cost rate, records Eco chats (ADR 0016)
    digest.ts      the daily digest: builds it, and decides when the notification is due (ADR 0016)
    ptyHost.ts     the terminal host: a utilityProcess that owns every pseudo console (ADR 0018); pty.ts talks to it
    recap.ts       "what we worked on" from a transcript (streamed, cached), and the one-shot Haiku calls: summarize a chat, name chats (ADR 0017)
    vault.ts       docs vault: reads docs/ + root notes with links, watches them, starts Claude's build/update tasks (ADR 0014)
    skills.ts      Skills page: personal, plugin and project skills read from disk (ADR 0015)
    promptStudio.ts Prompt Studio: resource library, URL and file import, saved prompts, one-shot claude -p generator (ADR 0035)
    eco.ts         Eco mode: launch flags (model, effort, autocompact, plugin) and the long-chat coach
    ecoPlugin.ts   the eco:coach skill, written as a plugin to the app's data folder for --plugin-dir
    spend.ts       live chat size, startup report, MCP servers per project, extra launch args (model, --strict-mcp-config)
    smoke.ts       self-test run with MC_SMOKE=<png path>
  preload/     exposes a typed `window.mc` API to the UI (contextIsolation on)
  shared/      types used by both sides (MissionControlApi lives here)
    planUsage.ts    parses the plan-usage response; pace forecast; window names, "resets in" text (pure, unit-tested)
    planCost.ts     calibration (share of a window per API-priced dollar), shares, tokens per 1%, the Eco check (pure, unit-tested)
    digest.ts       day keys, when the digest is due, its notification text (pure, unit-tested)
    recap.ts        the recap builder (prompts, files, commits, last reply, active time) and parsing Claude's answers (pure, unit-tested)
    skills.ts       skill uses in transcripts, coach levels and wording (pure, unit-tested)
    promptStudio.ts prompt ranking, generator input, reply parsing, HTML to text (pure, unit-tested)
    codex.ts        Codex rollout lines: prompts, replies, commands, patched files, recap, token totals, plan limits, OSC 7501 states (pure, unit-tested)
    handoff.ts      the handoff file and prompt (pure, unit-tested)
    taskConsole.ts  background task JSON lines as CLI-like terminal text (pure, unit-tested; ADR 0030)
    vault.ts        frontmatter, [[wikilinks]], link resolution, headings, the vault prompts (pure, unit-tested)
    projectLook.ts  README title/description, icon guess, worktree paths, chat titles (pure, unit-tested)
  renderer/    React UI
    src/App.tsx              app state and layout: projects, git info, views, dialogs; wires the hooks below
    src/app/useAgents.ts     open agents: launch, close, hook status + notifications, restore, chat sizes, maximize
    src/app/useTasks.ts      task list and the actions that run tasks
    src/app/useWorkspaces.ts saved agent sets and the grid column setting
    src/app/useAppSettings.ts settings, theme, zoom
    src/app/commands.ts      the command palette list
    src/app/shortcutActions.ts what each keyboard shortcut does
    src/inbox.ts             the "Needs you" inbox worked out from live state (pure, unit-tested)
    src/planRate.tsx         plan-cost context and the PlanShare label ("≈0.4% wk")
    src/terminalBus.ts       routes PTY output to every pane showing it (history replay, one input owner)
    src/agentStatus.ts       hook event -> agent status, and what each status looks like
    src/toast.tsx            in-app messages (useToast)
    src/projectLook.tsx      icon components and LookContext: any project path or name -> name, icon, color
    src/shortcuts.ts         every keyboard shortcut, key matching, terminal-safe rules, rebinding (ADR 0010)
    src/components/
      ui.tsx                 shared building blocks: Button, IconButton, Avatar, MenuButton, Segmented, EmptyState
      Sidebar, HomeView, ProjectView, OverviewPanel, SessionViewer, VaultView (VaultGraph, NoteMarkdown), PlanMeter, SkillsView, PromptStudioView
      AgentsView, TerminalPane, ChangesPanel, DiffView, CommandPalette, StatusBar
      SearchView, UsageView, TasksView, TaskAgentWorkspace, TaskTerminal, TaskConsole, TaskComposer, TaskDrawer, SettingsDialog, IdentityDialog, ShortcutsDialog, SpendingCard
      TopBar, ProjectsView, NotebookView, KnowledgeView, DocViewer, NewProjectDialog
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

**Task agent workspace (ADRs 0030, 0031).** Tasks → Task agents groups each task's planner, workers and integrator in Tabs or Grid. Starting/resuming a team opens its workspace; team cards and drawers also provide Watch agents. Waiting agents explain their dependencies; completed runs remain selectable. `renderer/src/taskWorkspace.ts` derives groups and statuses from the existing typed task list. For background runs, `shared/taskConsole.ts` formats JSON events as CLI-like text. `tasks.ts` retains per-task output (`getTaskOutput`) and streams it (`tasks:output`) to a read-only xterm (`TaskConsole`). Interactive tasks show the agent's own PTY (`TerminalPane`). `terminalBus` replays a terminal's history to every pane showing it and lets only one pane send input. Navigation never launches duplicate runs or changes coordinator ownership.

## Templates, schedules and the queue

**Live CLI teams (ADR 0034).** The Split into agents UI defaults to `TaskTeam.mode = interactive`. Planning stays in the structured background runner; workers/integration launch through `taskCli.ts` into the existing PTY host. The coordinator owns `run.agentId` independently of the standalone Agents list. Claude hooks/Codex state events expose turn readiness. Finish assignment captures a bounded handoff, closes and waits for the CLI, then settles dependencies through the normal team pipeline. CLI idle alone never completes work. Background teams, including older saved teams, retain their runner and USD caps. Live teams explicitly have no USD cap. Terminal navigation shares output through terminalBus and does not launch or restore another process.

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

`updater.ts` wraps electron-updater. Packaged builds check `Brawly0/mission-control` 15 seconds after start and every 6 hours (setting `autoUpdate`), download in the background, and install on the next restart or right away from **Update ready · Restart**. Releases and source share the one public repo (see ADR 0006 for the history).

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
| `plan_readings` | plan-limit readings (window, time, reset, utilization), 90 days; Mission Control's own data, kept across schema changes (ADR 0016) |

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

## Codex agents (ADR 0020)

A `codex` agent runs `codex` (found on PATH) in the terminal host like `claude`. Codex writes its state into the terminal as `ESC ] 7501 ; state=working:app=codex BEL` (idle, working, done, blocked with kind=permission). `terminals.ts` reads it from the output (keeping a split sequence for the next chunk) and sends a `CodexState` hook event; `agentStatus.ts` maps it to the same statuses as Claude's hooks. Codex can't be given a chat id, so after a new Codex agent starts, `findNewCodexSession` looks for the newest rollout in that folder created since the launch and not claimed by another agent, and reports it as `CodexSession`. Resume is `codex resume <id>`. Codex chats appear in `listSessions` with `tool: 'codex'` and `projectKey: 'codex'`; `getSession('codex', id)` and `sessionRecap` read them from `~/.codex`, which is never written.

## Restoring agents

New claude sessions are started with `--session-id <uuid>` chosen by the app, so the app always knows which transcript an agent belongs to. `SessionStart` updates the id if it changes (for example after `/clear`). The open agents are saved to the store whenever they change. Saving stops during quit, so the exits that happen on shutdown don't wipe the list. On the next start, a banner offers to restore them: claude agents reopen with `--resume <id>`, or start fresh if that session never got a prompt.

## IPC surface

All channels are listed in `src/preload/index.ts` and typed by `MissionControlApi` in `src/shared/types.ts`. Add new features by extending the interface, the preload and an `ipcMain` handler, in that order.

## Guided setup and readiness

`shared/readiness.ts` defines terminal snapshots, stable check IDs, sanitized explanations, untrusted command suggestions and additive guided-setup persistence. `main/readiness.ts` performs asynchronous read-only PATH, CLI version/authentication, folder, Git and manifest checks. `main/ipc.ts` assigns renderer ownership; preload exposes `getGuidedSetup`, `updateGuidedSetup`, `checkConnections`, `checkProjectReadiness` and `cancelReadiness` through the typed API.

The service bounds concurrency (two jobs), total admitted jobs (16), subprocess time (six seconds), whole-job time (25 seconds), process output (32 KiB) and manifest reads (128 KiB). A new request supersedes the renderer's previous request for the same connection/project slot. Cancellation kills diagnostic process trees; pending filesystem work retains its capacity until it settles. Shutdown cancels outstanding work. The renderer renders checking locally and accepts only the latest request ID. Ready describes only that individual verified check: unknown auth output, offline probes and unavailable tools cannot imply success.

`app/useReadiness.ts` shares connection/project snapshots and setup preferences among setup, project readiness, existing connection cards and the Inbox. Problems reconcile fresh check IDs; missing checks do not erase unresolved problems. A verified individual check resolves independently of unavailable checks in the same snapshot. `problems.ts` also derives task failures from real run/check state. First-task guidance binds an explicit task and run identity; result observation and diff-fingerprint observation are separate evidence. ChangesPanel reports the displayed snapshot and explicit "Reviewed this diff and results" acknowledgement through TaskDrawer to App. New snapshots or failed reads invalidate diff evidence; result viewing preserves diff evidence only within the same completed run. Review loads reject superseded responses and responses from previous paths or unmounted surfaces. Guide completion does not mark done or merge.

Only root package.json scripts are inferred, with npm/pnpm/yarn/bun selection from package-manager metadata and lockfiles. Recognized non-JavaScript manifests remain unsupported for inference. Suggestions retain provenance and are not executable diagnostics. RunPanel requires review/edit/save via existing project metadata and a separate Run action. No check installs dependencies, initializes Git or executes project scripts.

`main/onboardingSmoke.ts` supplies a Windows local-provider fixture tour through the real renderer, preload, IPC, service, child runner and Git diff. `smoke.ts` bootstraps its restricted provider PATH before ready and dispatches its tour before legacy smoke paths. A separate process invocation verifies restart persistence. See DEVELOPMENT for isolation requirements, exact commands and current coverage limits, and [ADR 0030](decisions/0030-guided-setup-and-readiness.md) for the decisions.
