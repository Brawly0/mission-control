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

## ✅ v0.4: Organization
- [x] Groups (sidebar sections, collapsible) and tags (filter chips) for projects
- [x] Per-project status (active / paused / done) and Markdown notes that save as you type, in a new Overview tab
- [x] Full-text search across all chats (SQLite FTS5 in a worker thread, incremental; Ctrl+Shift+F)
- [x] Usage view: estimated cost and tokens per day, project, model and chat; cost per chat in chat lists

## ✅ v0.5: Tasks
- [x] Kanban board (To do / Running / Review / Done) with drag and drop; Start launches an agent on a card
- [x] Headless tasks: `claude -p --output-format stream-json` in the background, with live activity, tool calls, cost and result on the card
- [x] Per task: interactive or headless, permission mode, model, budget cap, own worktree
- [x] Task detail panel: prompt, result, activity timeline, worktree changes, Continue in terminal, Run again
- [x] Tray icon with status and menu; global show/hide hotkey (default Ctrl+Alt+M); close to tray while work runs
- [x] Plan rate-limit meters (5-hour and 7-day windows) in the status bar and Usage view

## ✅ v0.6: Automation
- [x] Task templates with `{{project}}`, `{{date}}`, `{{time}}`, `{{weekday}}` variables; Save as template from New task
- [x] Recurring templates: hourly, daily, weekdays, weekly; then start, queue, or add to To do
- [x] Auto-queue: queued headless tasks start by themselves, N at a time, held while plan usage is above a limit
- [x] Auto-update from the public releases repo (Brawly0/mission-control-releases); status bar shows "Update ready · Restart"

## ✅ v0.7: Chains and guardrails
- [x] Task dependencies: "Run after…", blocked/waiting/ready chips, Run anyway, chain view; loops prevented
- [x] Chains build on each other: a worktree task starts from the previous task's branch
- [x] Pipeline templates (steps), schedulable
- [x] Checks after a task: per-project command, ✓/✗ with output, Re-run checks; dependencies require passing checks
- [x] Headless worktree tasks commit their changes automatically (ready to merge)
- [x] Follow-up box: continue a finished task's chat in the background
- [x] Turn on git: preview, safe .gitignore, first commit (secrets and dependencies kept out)
- [x] Guardrails: default task budget, monthly project budgets with 80% warning, automation holds when over budget or plan usage is high
- [x] Unit tests (Vitest) and Windows CI (GitHub Actions)

## Next ideas
- [ ] Code signing so Windows SmartScreen stops warning
- [ ] Parallel branches in a chain (fan-out / fan-in) with automatic merge of several branches

## Later
- [x] Installer (`npm run dist`)
- [ ] Usage: per-project budgets and alerts
- [ ] Themes (light mode)
- [ ] MCP server and plugin overview per project
