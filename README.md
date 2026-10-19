# ◆ Mission Control

A Windows desktop hub for **Claude Code**: see all your projects and past chats, read docs, and run several Claude agents side by side in live terminals.

## Features (v0.2)

- **Projects sidebar**: found automatically from `~/.claude/projects`, plus any folder you add. Pin favorites; worktrees and scratch folders are hidden by default.
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

Mission Control **never writes to Claude Code's files**. Your own data (pins, added folders) lives in `%APPDATA%\Mission Control\store.json`.

## Getting started

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
| `npm run dist` | Build a Windows installer into `dist/` |

## Documentation

- [Architecture](docs/ARCHITECTURE.md): how the app is put together
- [Roadmap](docs/ROADMAP.md): what's planned next
- [Development](docs/DEVELOPMENT.md): setup, testing, troubleshooting
- [Decisions](docs/decisions/): why things are the way they are
