# 0022: Agent connections, project order and a terminal button

Date: 2026-10-27

**Connections.** The sidebar's "Claude Code · Connected" card did nothing and only knew about Claude. It becomes "Agent connections": one row per agent (installed, signed in), expanding to version and plan, the command to install or sign in, Usage, a terminal for those commands and refresh. Codex is checked by running `codex --version` and `codex login status` (cached 5 minutes), not guessed from old chat files. Nothing in `~/.codex` is written.

**Project order and names.** Projects get an optional `ProjectMeta.sortOrder`, saved through a new `projects:reorder` IPC that writes the whole order at once, so filtering never loses hidden projects. Projects without one keep the old order (pinned, active before done, recent first) after the sorted ones. In the sidebar a drag stays inside its section (pinned or a group); moving to another section is still Pin or Group. Rename reuses the existing name-and-icon dialog: it changes the shown name, never the folder. Both the sidebar and the Projects page share one hook (`useProjectActions`) for the right-click menu (open, rename, pin, terminal, Explorer, move up/down) and drag handling; the menu also opens with the context-menu key or Shift+F10.

**Terminal.** A Terminal button on the Agents bar opens a plain PowerShell agent in the active agent's folder (so a worktree's own folder), falling back to the selected project. It's the first, small step toward the terminal dock in the roadmap.

Verification: typecheck, build and 149 unit tests pass; `MC_SMOKE_WORKSPACE` passes (connections, rename, drag in both places, terminal folder).
