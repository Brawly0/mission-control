# Architecture

Mission Control is an Electron app with three parts, built by `electron-vite`.

```
src/
  main/        Node side: file access, PTYs, IPC handlers
    index.ts       window + IPC registration
    claudeData.ts  reads ~/.claude/projects (projects, sessions, chat transcripts)
    pty.ts         spawns claude / PowerShell in pseudo-terminals (ConPTY)
    store.ts       the app's own JSON store (pins, manually added folders, open agents)
    hookServer.ts  local HTTP endpoint that receives Claude Code hook calls
    smoke.ts       self-test run with MC_SMOKE=<png path>
  preload/     exposes a typed `window.mc` API to the UI (contextIsolation on)
  shared/      types used by both sides (MissionControlApi lives here)
  renderer/    React UI
    src/App.tsx              app state: projects, agents, layout
    src/terminalBus.ts       routes PTY output to the right terminal pane
    src/agentStatus.ts       hook event -> agent status, and what each status looks like
    src/components/          Sidebar, ProjectView, SessionViewer, DocsPanel, AgentsView, TerminalPane
```

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
- The port is random and the URL carries a per-run secret, so other local processes can't post fake events.
- Settings files are deleted when an agent exits and cleared at every startup.

## Restoring agents

New claude sessions are started with `--session-id <uuid>` chosen by the app, so the app always knows which transcript an agent belongs to. `SessionStart` updates the id if it changes (for example after `/clear`). The open agents are saved to the store whenever they change. Saving stops during quit, so the exits that happen on shutdown don't wipe the list. On the next start, a banner offers to restore them: claude agents reopen with `--resume <id>`, or start fresh if that session never got a prompt.

## IPC surface

All channels are listed in `src/preload/index.ts` and typed by `MissionControlApi` in `src/shared/types.ts`. Add new features by extending the interface, the preload and an `ipcMain` handler, in that order.
