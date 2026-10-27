# 0021: Explicit agent choice and quieter headers

Date: 2026-10-27

The project header exposes Claude and Codex equally through a selector beside New session. Store the choice as optional `ProjectMeta.preferredAgent` using the existing metadata IPC and store. Existing projects default to Claude. Generic new-session actions, worktree launches and briefing starts honor it; resuming a chat and explicit provider actions retain their own provider. Headless tasks are unchanged.

Always show provider badges in chat lists, the viewer and agent headers/tabs. Move project utilities and secondary agent actions into menus while keeping status and maximize directly accessible. Agent menus render through an optional portal on the existing MenuButton so grid-cell clipping cannot hide them.

Verification: typecheck, build and 146 unit tests pass. The isolated agents UI tour verifies selector persistence/navigation and exercises menus, resizing, minimize, maximize and restore. The Codex tour's handoff interaction follows the new menu path.
