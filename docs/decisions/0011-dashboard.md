# 0011: Dashboard look, with every number from real data

**Status:** accepted · 2026-10-24

## Context

The user supplied a mockup for the next version: a top bar, a regrouped sidebar, a Home dashboard with cards, and Notebook and Knowledge pages. Some of its panels held placeholder values ("API usage 42%", "Storage 68%", quotes, due dates that tasks didn't have).

## Decisions

- **No placeholder numbers.** Every number on Home comes from the app:
  - Project and chat counts come from the project list.
  - Open tasks come from the board.
  - The week's usage comes from the chat index (calendar days, so daylight-saving changes don't shift them).
  - System status shows Claude Code's own `auth status` and the plan limits it reports.
  - The quote area shows short original lines, one per day, with no attribution.
- **Notebook = your notes + project notes** (the user's choice). Your notes live in the app's store (`notes`). Project notes stay in `ProjectMeta.notes`, so they show in both places.
- **Knowledge = docs across projects** (the user's choice). It reuses the Docs finder (CLAUDE.md, README, AGENTS.md, `docs/`, `.claude/`), caches the list for a minute, and searches by reading files under 1 MB. Edits go through the same viewer as the Docs tab.
- **Due dates with reminders** (the user's choice). `Task.dueAt` is a local time; with only a date it's 9:00. `tasks.ts` hands out each reminder once (`remindedAt`), and changing the due date re-arms it.
- **The account's email is never shown.** The status card uses only `loggedIn`, `authMethod` and `subscriptionType`. The greeting name is the one in Settings, else the first word of the Windows account's full name.
- **Quick chats run in Windows' temp folder**, so they're listed under "worktrees & scratch", not as projects.
