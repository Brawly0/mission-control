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

## ✅ v0.14: Pace forecast and docs vault
- [x] Pace forecast for plan limits: projected usage at reset (faint bar), "out in …" in the top bar when a limit will run out first, a pace line on the Usage card, and an early alert
- [x] Docs vault per project: Claude builds docs/ as an Obsidian-style vault (INDEX hub, overview, architecture, setup, conventions, status, decisions) and links it from CLAUDE.md
- [x] Vault browser in the Docs tab: tree, [[wikilinks]], properties, outline, links and backlinks, graph view, live updates, new note
- [x] "Keep up to date": Claude refreshes the vault after each compaction (opt-in per project)

## ✅ v0.15: Skills and Eco mode
- [x] Skills page: every personal, plugin and project skill, what it does, how often you and Claude use it (from your chats), and what it costs in context; unused skills flagged
- [x] eco:coach skill, shipped as a plugin loaded into Mission Control's chats (--plugin-dir), or copied into a project
- [x] Eco mode (top bar, Ctrl+Alt+L): Sonnet by default, compact at 150k, optional lower effort, the eco:coach skill
- [x] Long-chat coach: the hook server tells Claude once at 60% and 85% of the compaction size (and when the session limit is nearly used up) to suggest compacting or a fresh chat

## ✅ v0.16: Plan cost and the inbox
- [x] Plan readings saved (90 days) and read back after a restart
- [x] Plan cost: share of the weekly (and session) limit per chat, task, project and vault build, calibrated from your readings against logged usage; 1% of the week in dollars and tokens per model
- [x] Eco check: cost per reply in Eco chats against the rest
- [x] "Needs you" inbox: agents, reviews, failures, due dates, limits, budgets, queue, updates; dismiss until something new happens; sidebar badge
- [x] Daily digest on the Inbox page and as a morning notification (time in Settings → General)

## ✅ v0.17: Agent layout, recaps and chat names
- [x] Minimize agents to a dock, maximize one to fill the window, resize grid columns and rows by dragging, choose the column count
- [x] Open a project's latest (or all) chats as agents in one click; resuming an open chat shows it
- [x] "What we worked on" recap in the chat viewer and as a "Last time" banner on resumed agents; optional summary by Claude
- [x] Clearer chat names: better first-prompt titles, Claude Code's ai-title, dates on duplicates, Name chats with Claude
- [x] One-click updates: an Update button in the top bar downloads and restarts; checks every 30 minutes and when the window gets focus

## ✅ v0.18: Reliable terminals, workspaces, send to several
- [x] Terminals run in a separate host process; closing a busy agent or quitting with many can't freeze the app (Windows ConPTY close deadlock)
- [x] Workspaces: save and reopen sets of agents with their layout
- [x] Send one prompt to several agents, with ready-made prompts
- [x] Self-tests run in their own profile (work while the installed app is open); quit stress test
- [x] Chat index survives a worker crash or a locked database (queries fail and retry instead of hanging); removing a worktree finishes even when Windows held the folder a moment

## ✅ v0.19: Make it solid
- [x] Real-use walkthrough: Markdown tables render everywhere, scratch folders hidden, palette groups, cleaner cards, search snippets and model names, DEVELOPMENT.md repaired
- [x] Code cleanup: App.tsx split into src/app/ hooks (1,349 → 852 lines); main/index.ts split into window, ipc, notify, terminals, docs (795 → 176 lines)
- [x] Speed and resource use (ADR 0019): renderer minified and rarely used code loaded on first use (startup JS 2.2 MB → 437 KB); idle CPU with 4 agents 2.5% → 0.8% (only working agents pulse); fewer git processes; speed self-test MC_SMOKE_PERF
- [x] UI simplification: less-used pages under **More** in the sidebar; one Settings button (your initials) and no theme button in the top bar (Settings → Appearance, Ctrl+Shift+L); no clock card on Home; the status bar only shows what's happening or needs you; "open" vs "working" agents labelled honestly everywhere (Home, tray, Projects); Settings reviewed and left as is
- [x] Known-issues backlog: everything fixable in the app is done. Left for you: delete old scratch chat folders in ~/.claude/projects if wanted, fix the GitHub MCP auth header, try Eco, Build vault and the morning digest in real use

## ✅ v0.20: Claude and Codex together (ADR 0020)
- [x] Codex agents in the app's terminals: New Codex session, status lights and notifications from Codex's own state signal, the trust screen shown as "needs you", restore and workspaces reopen the chat (`codex resume`)
- [x] Codex chats in each project's chat list with a badge; viewer, recap, rename and Summarize work for them
- [x] Handoffs both ways: "Continue in Codex / Claude" writes what the last chat did (asks, files, commits, git, rules, latest messages) to docs/briefings/ and starts the other agent reading it, in the same folder or worktree
- [x] Shared rules: one click adds an AGENTS.md that points Codex at CLAUDE.md
- [x] Codex usage: its 5-hour and weekly limits in the top bar next to Claude's, tokens by project and model on the Usage page
- [x] Self-test MC_SMOKE_CODEX (one short Codex turn and one short Claude turn)

## v0.21: UI clarity
- [x] Visible Claude / Codex selector beside New session, saved per project; new sessions, shortcuts, worktrees and briefing starts use the choice
- [x] Always label Claude and Codex chats and agents; simplify project and agent headers with secondary actions in menus (ADR 0021)

## v0.22: Projects, connections and a terminal button
- [x] Agent connections in the sidebar: Claude and Codex each show installed / signed in / version and plan, with setup commands, Usage, a terminal and refresh (ADR 0022)
- [x] Rename projects (display name only, the folder stays), drag to sort and right-click actions, in the sidebar and on the Projects page; the order is saved
- [x] Terminal button on the Agents bar: opens PowerShell in the active agent's folder (its worktree too), or the selected project
- [x] Self-test MC_SMOKE_WORKSPACE (no model calls)

## v0.23: Ask, run, review
- [x] Project Run panel: save commands, stream output, stop process trees, copy output and send a result to either agent (ADR 0023)
- [x] Shared project briefing: editable preview, recent chats from both agents, tasks, verification and git; new empty sessions and handoffs read the saved context
- [x] Codex in tasks: headless execution, resume, interactive tasks, queue and mixed-agent pipeline steps; provider labels and honest budget handling (ADR 0024)
- [x] Codex chats in incremental full-text search; Send to several agents for both tools
- [x] Review workflow: checks and read-only agent findings beside the diff, human review and checks tied to the current source snapshot before merge
- [x] Measure startup/idle CPU/memory; remove app-wide idle ticking and closed-menu layout reads, defer new tabs and hidden transcript reads

## Next ideas
- [ ] Project terminal dock and "Run this for me" for commands an agent can't run (works for both agents)
- [ ] Prompt snippets you can insert into any agent
- [ ] Code signing so Windows SmartScreen stops warning
- [ ] Parallel branches in a chain (fan-out / fan-in) with automatic merge of several branches

## Later
- [x] Installer (`npm run dist`)
- [x] Usage: per-project budgets and alerts (v0.7)
- [x] Themes (light mode) (v0.10)
- [ ] MCP server and plugin overview per project
