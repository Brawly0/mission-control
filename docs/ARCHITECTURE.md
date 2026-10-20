# Architecture

Mission Control is an Electron app with three parts, built by `electron-vite`.

```
src/
  main/        Node side: file access, PTYs, IPC handlers
    index.ts       window + IPC registration
    claudeData.ts  reads ~/.claude/projects (projects, sessions, chat transcripts)
    pty.ts         spawns claude / PowerShell in pseudo-terminals (ConPTY)
    store.ts       the app's own JSON store (pins, added folders, open agents, UI state, window bounds)
    hookServer.ts  local HTTP endpoint that receives Claude Code hook calls
    git.ts         git status, worktrees, diffs, commit, merge (runs the git CLI)
    indexer.ts     starts the index worker and relays queries to it
    indexWorker.ts worker thread: SQLite full-text index + token usage of every chat
    pricing.ts     API list prices per model, for cost estimates
    smoke.ts       self-test run with MC_SMOKE=<png path>
  preload/     exposes a typed `window.mc` API to the UI (contextIsolation on)
  shared/      types used by both sides (MissionControlApi lives here)
  renderer/    React UI
    src/App.tsx              app state: projects, git info, agents, views, command palette
    src/terminalBus.ts       routes PTY output to the right terminal pane
    src/agentStatus.ts       hook event -> agent status, and what each status looks like
    src/toast.tsx            in-app messages (useToast)
    src/components/
      ui.tsx                 shared building blocks: Button, IconButton, Avatar, MenuButton, Segmented, EmptyState
      Sidebar, HomeView, ProjectView, OverviewPanel, SessionViewer, DocsPanel
      AgentsView, TerminalPane, ChangesPanel, DiffView, CommandPalette, StatusBar
      SearchView, UsageView
    src/organize.css         styles for groups, tags, overview, search and usage
```

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
