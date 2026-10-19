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

## v0.3: Parallel agents without conflicts
- [ ] Remember the last selected project, layout and window size
- [ ] "New agent in worktree": create a git worktree and branch per agent automatically
- [ ] Diff panel: review an agent's changes, then merge or discard
- [ ] Git status badges in the sidebar (branch, dirty, ahead/behind)

## v0.4: Organization
- [ ] Tags and groups for projects (Work / Trading / Games …)
- [ ] Per-project notes and status (active / paused / done)
- [ ] Full-text search across all chats (SQLite FTS index)
- [ ] Token and cost stats per project and session

## v0.5: Tasks
- [ ] Kanban board: a card is a task; "Start" launches an agent on it
- [ ] Headless agents with `claude -p --output-format stream-json`, with progress in the card
- [ ] Command palette (Ctrl+K) and a global hotkey / tray icon

## Later
- [ ] Installer and auto-update (`electron-builder`)
- [ ] Themes (light mode)
- [ ] MCP server and plugin overview per project
