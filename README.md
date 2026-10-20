# ◆ Mission Control

A Windows desktop hub for **Claude Code**: see all your projects and past chats, read docs, and run several Claude agents side by side in live terminals.

## Features (v0.4)

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
| `npm run dist` | Build the Windows installer into `release/` |
| `npm run icon` | Re-render `build/icon.png` from `build/icon.svg` |

## Documentation

- [Architecture](docs/ARCHITECTURE.md): how the app is put together
- [Roadmap](docs/ROADMAP.md): what's planned next
- [Development](docs/DEVELOPMENT.md): setup, testing, troubleshooting
- [Decisions](docs/decisions/): why things are the way they are
