# Roadmap

## ✅ v0.1: Foundation
- [x] Project discovery from `~/.claude/projects` plus manual folders
- [x] Pinning, filter, hidden worktrees and scratch folders
- [x] Session list with titles, search, transcript viewer
- [x] Embedded terminals: new / continue / resume / shell
- [x] Tabs and grid layout, activity status lights
- [x] Docs panel with view and edit
- [x] Open in Windows Terminal / VS Code / Explorer

## ✅ v0.2: Real agent status
- [x] Claude Code **hooks** report to a local endpoint in the app, giving exact working / needs-you / done states
- [x] Windows notification when an agent finishes or needs permission; clicking it opens that agent
- [x] Rename agent tabs (double-click)
- [x] Restore open agents after restarting the app (exact session via `--session-id` + `--resume`)

## ✅ v0.3: Parallel agents without conflicts + new UI
- [x] Remember the last selected project, view, layout and window size
- [x] "New session in worktree": a git worktree and `mc/agent-xxxx` branch per agent
- [x] Review panel: an agent's diff next to its terminal; commit, merge into the base branch, or discard
- [x] Changes tab on every git project (uncommitted changes, commit all)
- [x] Git badges in the sidebar and project header (branch, changed files, ahead/behind)
- [x] Redesigned UI: Home dashboard, project avatars, icons, page tabs, status bar, toasts
- [x] Command palette (Ctrl+K, or Ctrl+Shift+P inside a terminal)

## v0.4: Organization
- [ ] Tags and groups for projects (Work / Trading / Games …)
- [ ] Per-project notes and status (active / paused / done)
- [ ] Full-text search across all chats (SQLite FTS index)
- [ ] Token and cost stats per project and session

## v0.5: Tasks
- [ ] Kanban board: a card is a task; "Start" launches an agent on it
- [ ] Headless agents with `claude -p --output-format stream-json`, with progress in the card
- [ ] Global hotkey and tray icon

## Later
- [ ] Installer and auto-update (`electron-builder`)
- [ ] Themes (light mode)
- [ ] MCP server and plugin overview per project
