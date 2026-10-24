# 0012: Session briefings from compaction summaries

**Status:** accepted · 2026-10-24

## Context

When a chat ran out of room, the user asked Claude, every time, to document the session and write a briefing for the next one. Claude Code already writes such a summary when it compacts a chat. It's stored in the transcript as a user message with `isCompactSummary: true`, after a `compact_boundary` system entry that has `compactMetadata.trigger` (`auto` or `manual`) and `preTokens`.

## Decisions

- **Reuse the summary instead of asking Claude for another one.** It's free (no extra request), works for every chat, not just ones Mission Control started, and appears exactly when it's needed. The index records each summary (`briefings` table, schema 6). After each index run, `briefings.ts` writes new ones to files.
- **Where:** `<project>/docs/briefings/<YYYY-MM-DD-HHmm>-<chat title>.md` when the chat's project is a real project folder. Worktree chats and chats started from `C:\` count as their project, as in the sidebar. Otherwise the file goes to `%APPDATA%\Mission Control\briefings\`. The file starts with a short header (when, which project, why it was compacted, how to resume the original chat), then the summary without Claude Code's wrapper lines.
- **From now on, not backwards.** The first run records a start time, so older summaries aren't dropped into project folders unasked. They're listed in Knowledge → Session briefings and can be saved with one click.
- **Quality comes from CLAUDE.md**, not from a second summarization pass. An opt-in button adds a "Summary instructions" section to the project's CLAUDE.md, asking for a handoff-style summary. It's never added automatically, because CLAUDE.md is the user's file.
- **Picking up is explicit.** "New session from latest briefing" passes a first prompt asking Claude to read the file and report where things stand. Nothing is injected into sessions silently.
