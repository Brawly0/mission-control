# ◆ Mission Control

A Windows desktop hub for **Claude Code**: see all your projects and past chats, read docs, and run several Claude agents side by side in live terminals.

## Features (v0.20): Claude and Codex together

- **Codex agents**: start the Codex CLI next to Claude from a project's **New session** menu or the palette ("New Codex session"). It runs in the same terminals, with the same status lights, notifications and inbox ("needs you" when it asks for approval). Install it once with `npm i -g @openai/codex`.
- **Hand off between them**: **Continue in Codex** (or **Continue in Claude**) on any chat, the **→ Codex / → Claude** button on an agent, or "Codex, continuing from Claude" in the New menu. Mission Control writes what the last chat did to `docs/briefings/` (what you asked, files changed, commits, git state, the project's rules and the latest messages) and starts the other agent by reading it, in the same folder or worktree. Free: no model call.
- **One chat list**: Codex chats show in each project's Chats with a **Codex** badge; open, resume, rename or summarize them like Claude's.
- **Same rules for both**: Claude reads CLAUDE.md and Codex reads AGENTS.md. On a project's Overview, **Share with Codex** adds an AGENTS.md that points to CLAUDE.md.
- **Codex usage**: its 5-hour and weekly limits sit in the top bar next to Claude's, and the Usage page shows Codex tokens by project and model.

## Features (v0.18)

- **Workspaces**: save the open agents with their layout under a name ("Bot: daily review") and reopen them in one click. Each chat resumes where it left off. Find them under Agents → Workspaces, in the command palette, or on the empty Agents page.
- **Send to several agents** (`Ctrl+Shift+A`): type one prompt and send it to the agents you pick. Ready-made: write a briefing (each to its own file), "where are you?", wrap up, /compact.
- **Quitting with busy agents never hangs**: terminals now run in their own background process, so closing an agent while Claude is typing, or quitting with many agents running, can't freeze Mission Control.

## Features (v0.17)

- **One-click updates**: when a new version is out, an **Update** button appears in the top bar. One click downloads it and restarts into it. Mission Control checks every 30 minutes and whenever you come back to the window.
- **Agent layout controls**: minimize an agent to the dock (`Ctrl+Shift+Down`), maximize it to fill the whole window (`Ctrl+Shift+Up` or double-click its header), and drag the dividers in the grid to resize columns and rows (double-click to even out). Pick Auto or 1–4 columns.
- **Open as agents**: from a project's Chats tab, resume its 2, 4 or 8 latest chats (or all of them) side by side in one click. A chat that's already open is shown instead of started twice.
- **What we worked on**: clicking a chat shows a recap at the top: active time, what you asked first and last, files changed, commits and Claude's last reply. Resumed agents get a one-line "Last time: …" banner. **Summarize with Claude** writes a short summary and a clear title for a fraction of a cent.
- **Clearer chat names**: better automatic titles (no "ok can you…", briefing chats named after the briefing), Claude Code's newer titles, dates on chats that share a name, and **Name chats**: one cheap Haiku call gives clear names to chats whose names say little, like "Next task briefing". Your own names always win.

## Features (v0.16)

- **Plan cost per chat**: next to each chat, task, project and vault build, what it took of your weekly limit (≈0.4% wk). Mission Control saves your plan readings and compares them with what your chats used, so after a day or two it knows what 1% of your week is worth. The Usage page shows that in dollars and in tokens per model, and moves made outside this computer (claude.ai, phone) are left out.
- **Eco check**: the Usage page compares cost per reply in chats started with Eco mode against your other chats, so you can see whether it saves anything.
- **Inbox** (`Ctrl+Alt+I`): one list of everything waiting on you. That covers agents asking for permission or done with their turn, finished and failed tasks, overdue and due-today tasks, plan limits, budgets, a held queue and updates. Items clear themselves once dealt with; dismiss the rest. The sidebar counts them.
- **Daily digest**: yesterday (or today so far) in review on the Inbox page: chats, share of your week, busiest projects and chats, tasks finished, briefings, and what's waiting now. It also comes as a notification every morning at a time you choose (Settings → General).

## Features (v0.15)

- **Eco mode** (the leaf in the top bar, `Ctrl+Alt+L`): chats and tasks Mission Control starts use less of your plan. They default to Sonnet (Opus is one `/model opus` away), compact at 150k tokens instead of running up to the full window, and get the **eco:coach** skill. Fine-tune it in Settings → Spending. Most usage on long chats is Claude re-reading the chat on every reply, so compacting sooner is the biggest saving.
- **Long-chat coach**: when a chat reaches 60% and 85% of that size, or your session limit is nearly used up, Claude is told once to suggest `/compact` or a briefing plus a fresh chat at a good moment. Type `/eco:coach` for advice on the current chat any time.
- **Skills page**: every skill you have (personal, plugins, projects) with what it does, how often you and Claude actually used it, and how many tokens it adds to every chat. Unused skills are flagged; start a chat with any skill in one click. **Add to a project** copies eco:coach into a project, for chats you start outside Mission Control.

## Features (v0.14)

- **Docs vault for every project**: the Docs tab is now an Obsidian-style vault of the project's `docs/` folder. Click **Build vault with Claude** and Claude reads the project and writes a linked set of notes (INDEX hub, overview, architecture, setup, conventions, status, decisions), then points CLAUDE.md at it, so every new chat starts out knowing the project. Browse it with a folder tree, clickable `[[links]]`, backlinks, an outline and a **graph view**. Notes appear live as Claude writes them. Turn on **Keep up to date** and Claude refreshes the vault after each compaction. It runs as a background task with Sonnet by default, and it never touches your code.
- **Pace forecast**: the plan meters now show where you're heading. A faint bar shows the projected usage at reset; the top bar says **out in 2d 16h** when a limit will run out before it resets; the Usage page says when (for example "runs out ~Tue 12:29 PM, 2d 18h before it resets"); and you get an alert when you're on pace to run out soon.

## Features (v0.13)

- **Plan limits, always in view**: the top bar shows how much of your **5-hour session** and **weekly** limit you've used, with a colored bar and the time until each resets. They're the same numbers `/usage` shows in Claude Code, refreshed every 3 minutes and whenever you come back to the window. Click for details on the Usage page (% left, exact reset times, extra usage). You get a notification when a limit passes 80% (change it in Settings → Spending) and when one runs out.

## Features (v0.12)

- **Automatic session briefings**: when a chat runs out of room (or you `/compact`), Claude Code writes a summary so it can carry on. Mission Control saves that summary as a Markdown file in the project's `docs/briefings/` folder and notifies you. This works for every chat, including ones started outside Mission Control, and costs nothing extra. Chats without a real project folder save to Mission Control's own folder. It's on by default; turn it off in Settings → General.
- **Better briefings**: Overview → Automation → **Add to CLAUDE.md** adds a short "Summary instructions" section, so Claude writes those summaries as a proper handoff: state, decisions, next steps, gotchas.
- **Start from a briefing**: **New session → from latest briefing** (`Ctrl+Alt+B`) starts Claude by reading the newest briefing and saying where things stand. **Knowledge → Session briefings** lists every briefing in your chats, including older ones you can save with one click.
- **Briefing before the limit**: the **Briefing** button on an agent (`Ctrl+Shift+B`) asks Claude to write one now, to `docs/briefings/`.

## Features (v0.11)

- **New look**:
  - **Top bar:** search everything (`Ctrl+K`), a **+ New** menu (session, task, project, quick chat, note), and your initials, which open Settings.
  - **Sidebar:** the pages you use most, with Notebook, Templates, Knowledge, Skills and Usage under **More**; compact project rows and a live **Claude Code · Connected** card. It shows whether Claude Code is installed and logged in, and your plan.
- **Home dashboard**:
  - The greeting with your name (Settings → General), the date, and how many agents are open, working or need you.
  - Stats for projects, chats, open tasks and agents.
  - Action cards for New session, New task, New project and Quick chat.
  - Recent activity, your projects as cards (with quick filters: Active, Favorites, Recent, Archived), Open agents, and Upcoming tasks.
  - This week's usage, and your plan limits.
- **Projects page** (`Ctrl+7`): every project as cards or a list, with search and filters.
- **Notebook** (`Ctrl+8`): your own notes plus every project's notes in one place, in Markdown, saved as you type (`Ctrl+Shift+J` for a new note).
- **Knowledge** (`Ctrl+9`): every CLAUDE.md, README and `docs/` file across your projects, searchable, readable and editable in one view.
- **Due dates and reminders**: give a task a due date (and time), see it on the card and under Upcoming on Home, and get a Windows reminder when it's due.
- **New project** (`Ctrl+Shift+O`): creates a folder with a starter CLAUDE.md and git, or adds an existing folder. **Quick chat** (`Ctrl+Alt+N`) starts Claude in a throwaway folder that doesn't clutter your projects.

## Features (v0.10)

- **Shortcuts for everything**: 57 keyboard shortcuts for going places (`Ctrl+1`–`6`), starting sessions and tasks (`Ctrl+N`, `Ctrl+T`), switching agents (`Ctrl+Tab`, `Alt+1`–`9`), project tabs (`Alt+O/C/G/D`), the chat list (`Ctrl+F`, `Alt+J/K`, `Ctrl+Enter`), compacting a chat (`Ctrl+Shift+K`) and the view. Press `Ctrl+/` (or `F1`) for the full list. Click any shortcut there to change it, and conflicts are handled. Inside a terminal, plain `Ctrl+letter` keys stay with Claude and the shell. Tooltips and the command palette show each action's keys.
- **Collapsible sidebar**: `Ctrl+B` shrinks it to an icon rail with your projects' icons, and dots for running agents and tasks waiting for review.
- **Light theme and zoom**: Settings → Appearance (Dark, Light or Same as Windows; `Ctrl+Shift+L` switches). Zoom with `Ctrl+=`, `Ctrl+-` and `Ctrl+0`. Terminals stay dark.
- **Tidier screens**: Settings split into tabs; quick actions with their shortcuts on Home; Usage shows test, temp and scratch folders as one row.

## Features (v0.9)

- **Chat size on every agent**: a meter shows how big each live chat is. Every reply re-reads the whole chat, so cost per reply grows with it. It turns amber at 200K tokens (change it in Settings) and red when it's very large, with a **Compact** button that sends `/compact`. You also get one reminder per chat.
- **Expensive chat alert**: a Windows notification when one chat has cost more than $20 today (estimated at API prices; change or turn off in Settings). Click it to open the chat.
- **Default models**: each project can set the model for its new chats and tasks (Overview → Spending), and Settings has a default for tasks. Use Sonnet or Haiku for routine work.
- **What a new chat costs before you type**: Overview → Spending shows the typical size of the first reply in the project's recent chats, the CLAUDE.md and memory files loaded, and every MCP server. Uncheck servers a project never uses: agents and tasks Mission Control starts there then load only the checked ones (`--strict-mcp-config`). Claude's own config files aren't changed.

## Earlier features

- **Better project detection**: a chat you started in a parent folder (like `C:\` or your Desktop) and then spent in one project shows up under that project, marked "from C: drive". A project you only ever reached that way still gets its own entry. Folders Claude Code was opened in show up even before they have a saved chat. If a match is wrong, use **Move to project** on the chat.
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
- **Plan limits**: your 5-hour and 7-day plan usage, as reported by Claude Code, in the top bar and on the Usage page.

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
