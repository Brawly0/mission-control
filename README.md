# ◆ Mission Control

A Windows desktop hub for **Claude Code**: see all your projects and past chats, read docs, and run several Claude agents side by side in live terminals.

## Features (v0.8)

- **Readable names and icons**: projects are named from their README's title (e.g. "WBP · Journal & Intel", "Case Closed") with a one-line description, and get an icon that fits (game, journal, trading, bot, course…). Click a project's icon to set your own name, icon and color.
- **Worktree chats in their project**: chats Claude Code ran in a project's worktrees (`.claudeworktrees…`) show up under that project, each labeled with its worktree, instead of as hidden projects of their own.
- **Rename chats**: double-click a chat's title (or the pencil) to give it your own name. Leave it empty to get the automatic title back.

- **Chains**: give a task one or more tasks to **run after**. It waits (🔒) until they succeed, then starts by itself. If one fails, it stays blocked until you retry that task, or you press **Run anyway**. In worktrees, each step starts from the previous step's branch, so merging the last step brings in the whole chain. Templates can hold several **steps** (a pipeline), and pipelines can be recurring.
- **Checks**: set a check command per project (Overview → Automation, e.g. `npm test`). It runs after every headless task, the card shows ✓ or ✗ with the output, and a chain only moves on when the checks pass. Headless tasks in worktrees **commit their changes** automatically, so they're ready to merge.
- **Follow up**: continue a finished task's chat from its panel, in the background, without opening a terminal.
- **Turn on git**: one click makes a project a git repository after showing exactly what the first commit contains. Secrets (`.env`, keys) and dependencies are kept out.
- **Guardrails**: a default budget for headless tasks, and a monthly budget per project with a warning at 80%. Over budget, or while plan usage is high, the queue, recurring tasks and chains hold for that project.

- **Templates**: save tasks you run often (Save as template in New task, or Tasks → Templates). Titles and prompts can use `{{project}}`, `{{date}}`, `{{time}}` and `{{weekday}}`.
- **Recurring tasks**: give a template a schedule (every N hours, daily, weekdays or weekly at a time). When it fires, the new task starts, joins the queue, or waits in To do. Schedules run while Mission Control is open (it keeps running in the tray). If one came due while the app was closed, it runs once at the next start.
- **Auto-queue**: press **Queue** on headless tasks, then turn on **Auto-run queue** on the board. Queued tasks start by themselves, 1–4 at a time, and the queue holds while your plan usage is above a limit you choose (95% by default).
- **Auto-update**: the installed app checks [Brawly0/mission-control-releases](https://github.com/Brawly0/mission-control-releases) for new versions, downloads them in the background, and shows **Update ready · Restart** in the status bar.

- **Task board**: write tasks in To do, press **Start**, and they move through Running → Review → Done (drag cards between columns).
  - **Headless** tasks run Claude in the background, with no terminal. The card shows what it's doing right now ("Editing app.ts", "Running: npm test"), tool calls, time, cost and the final answer.
  - **Interactive** tasks open a normal agent terminal with the prompt.
  - Each task can have its own permission mode (Auto by default), model, budget cap (`--max-budget-usd`) and its own **worktree**, so several tasks can work in parallel without clashing. Review the diff, then merge.
- **Tray and hotkey**: a tray icon shows what's running and has a menu (New task, Task board, Quit). `Ctrl+Alt+M` shows or hides the window from any app (change it in Settings). Closing the window while agents or tasks run keeps them going in the tray.
- **Plan limits**: your 5-hour and 7-day plan usage, as reported by Claude Code, in the status bar and on the Usage page.

- **Search all chats** (`Ctrl+Shift+F`): full-text search over everything you and Claude wrote in every project, with highlighted snippets, filters for your prompts or Claude's replies, and one-click Open or Resume.
- **Usage**: estimated cost and tokens per day, project, model and chat, at Anthropic API list prices (an estimate; subscription plans don't pay these). Subagent usage counts toward its parent chat.
- **Organize projects**: put projects in groups (sidebar sections), add tags (filter chips), mark them active / paused / done, and keep Markdown notes in each project's **Overview** tab.

- **Home dashboard**: what every agent is doing, who needs you, recent chats across all projects, and one-click "New session" per project.
- **Command palette** (`Ctrl+K`, or `Ctrl+Shift+P` inside a terminal): jump to any project, agent or chat, or run any action.
- **Projects sidebar**: found automatically from `~/.claude/projects`, plus any folder you add. Each shows its git branch, a dot for uncommitted changes, and how many agents run in it. Pin favorites; worktrees and scratch folders are hidden by default.
- **Parallel agents without conflicts**: "New session in worktree" gives an agent its own git worktree and `mc/agent-xxxx` branch. **Review** opens the agent's diff next to its terminal, where you can commit, merge it into the base branch, or discard it.
- **Changes tab**: every git project shows its uncommitted changes as a diff, with "Commit all".
- **Chat browser**: every past session per project, with title, date and size. Search them, read the full conversation, or **Resume** it with one click.
- **Live agents**: start `claude` (new, continue or resume) or a plain PowerShell inside the app. View them as tabs or a grid, with status lights:
  - 🟢 working
  - 🟠 needs you (permission prompt or question)
  - 🔵 done, your turn
  - 🔴 exited

  Status comes from Claude Code hooks, so it's exact. You get a Windows notification when an agent finishes or needs you (toggle with 🔔), and clicking it jumps to that agent.
- **Rename and restore**: double-click a tab to rename it. Agents still open when you close the app are offered for restore next time, resuming the exact same chats.
- **Docs panel**: reads and edits `CLAUDE.md`, `README.md`, `AGENTS.md` and Markdown in `docs/` and `.claude/`.
- **Quick open**: Windows Terminal, VS Code or Explorer in the project folder.

Mission Control **never writes to Claude Code's files**. It remembers your last project, view, layout and window size. Your own data (pins, added folders, open agents) lives in `%APPDATA%\Mission Control\store.json`.

## Install

```bash
npm install
npm run dist
```

Then run `release\Mission Control Setup <version>.exe`. It installs for your user only (no admin rights needed) into `%LOCALAPPDATA%\Programs\mission-control` and adds **Desktop** and **Start menu** shortcuts. To update, run `npm run dist` again and run the new installer. To uninstall, use Windows **Settings → Apps**. Your pins and saved agents in `%APPDATA%\Mission Control` are kept.

The installer isn't code-signed, so Windows SmartScreen may warn the first time you run it. Click **More info → Run anyway**.

## Develop

Requirements: Windows 10/11, Node.js 20+, and [Claude Code](https://claude.com/claude-code) (`claude` on your PATH).

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Build to `out/` |
| `npm run typecheck` | Type-check main and renderer |
| `npm test` | Unit tests (Vitest); free, no Claude usage |
| `npm run dist` | Build the Windows installer into `release/` |
| `npm run release` | Build and publish a release for auto-update (see docs/DEVELOPMENT.md) |
| `npm run icon` | Re-render `build/icon.png` from `build/icon.svg` |

## Documentation

- [Architecture](docs/ARCHITECTURE.md): how the app is put together
- [Roadmap](docs/ROADMAP.md): what's planned next
- [Development](docs/DEVELOPMENT.md): setup, testing, troubleshooting
- [Decisions](docs/decisions/): why things are the way they are
