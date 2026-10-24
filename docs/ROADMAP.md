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

## ✅ v0.8: Names and icons
- [x] Project names from the README title, with a one-line description; your own name, icon and color per project
- [x] Icons guessed from the folder name and README, shown everywhere a project appears
- [x] Chats from a project's Claude Code worktrees listed under the project, labeled with the worktree
- [x] Rename chats in the app; Claude Code's automatic chat names used when there's no /rename title
- [x] Chats started from a parent folder (C:\, Desktop) matched to the project they worked in; Move to project corrects it
- [x] Folders Claude Code was opened in are listed even without saved chats

## ✅ v0.9: Spend less
- [x] Context meter on live agents (from Claude's latest reply), amber/red levels, Compact button, one reminder per chat
- [x] Expensive-chat alert: notification when one chat passes a daily cost (default $20)
- [x] Default model per project (new chats and tasks) and for tasks in Settings
- [x] Startup cost per project: measured first-reply size, CLAUDE.md and memory files, MCP servers
- [x] Per-project MCP picker: agents and tasks load only the chosen servers (--strict-mcp-config)

## ✅ v0.10: Keyboard and polish
- [x] Shortcut registry (57 actions), cheat sheet (Ctrl+/), rebinding with conflict handling, keys in tooltips and the palette
- [x] Terminal-safe rules: plain Ctrl+letter stays with Claude and the shell
- [x] Collapsible sidebar (icon rail), light theme and "same as Windows", window zoom
- [x] Settings in tabs, Home quick actions, Usage folds temp and scratch folders

## ✅ v0.11: Dashboard
- [x] New look: top bar with search and New menu, regrouped sidebar, Claude Code status card
- [x] Home dashboard: greeting, clock, stats, action cards, recent activity, project cards with filters, running now, upcoming tasks, weekly usage, plan limits
- [x] Projects page (cards or list), Notebook (own and project notes), Knowledge (all docs, searchable and editable)
- [x] Task due dates with reminders; New project (folder, CLAUDE.md, git); Quick chat in a throwaway folder
- [x] Icon guessing goes by the README title, then the most-mentioned kind

## ✅ v0.12: Session briefings
- [x] Every compaction summary saved as docs/briefings/<date>-<chat>.md (automatic, free, any chat), with a notification
- [x] "Summary instructions" for CLAUDE.md so summaries are written as a handoff
- [x] New session from latest briefing; Knowledge → Session briefings (save older ones, start from any)
- [x] Briefing button / Ctrl+Shift+B asks a running agent for a briefing before the limit

## ✅ v0.13: Plan limits, always in view
- [x] Session (5-hour) and weekly limit meters in the top bar on every page: % used, color by level, time to reset
- [x] Polled from your Claude account every 3 minutes and when the window gets focus (the numbers `/usage` shows), not only during headless tasks
- [x] Usage page: % left, reset times, plan name, extra-usage status, Check now
- [x] Alert when a limit passes a set level (default 80%) and when it runs out (Settings → Spending)

## Next ideas
- [ ] Project briefing: write or refresh BRIEFING.md from recent chats, so new chats start informed
- [ ] Prompt snippets you can insert into any agent
- [ ] One "Needs you" inbox and a daily digest
- [ ] Code signing so Windows SmartScreen stops warning
- [ ] Parallel branches in a chain (fan-out / fan-in) with automatic merge of several branches

## Later
- [x] Installer (`npm run dist`)
- [ ] Usage: per-project budgets and alerts
- [ ] Themes (light mode)
- [ ] MCP server and plugin overview per project
