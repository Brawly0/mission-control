# 0047: mc memory (history, project chats, briefings) and a context bar

Date: 2026-11-18. Status: accepted. Builds on 0046.

## Context
The user wanted mc to know what happened in the project's Claude and Codex chats, to keep its own chat history and
briefings, to show how full each agent's context window is, and to stop glitching when its pane is resized or moved.

## Decision
- **History lives in the git common dir** (`<git common dir>/mc-history/history.jsonl`, append-only, tail-read): it is per
  repo, shared by all worktrees, never committed and not in the working tree. Every run appends one entry (answered,
  committed, failed, no changes, stopped on Ctrl+C). An interactive session seeds the planner's "earlier" context with the
  last 6. `/new` clears only the in-memory context; `/history clear` empties the file.
- **Project chats are read-only** from `~/.claude/projects/<key>/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl`
  (overridable with `MC_CLAUDE_HOME` / `MC_CODEX_HOME`). Only the head (metadata, cwd) and tail (recent messages) of each
  file are read; files can be 30+ MB. The planner gets a compact digest (3 chats, 6 messages, 6000 chars) marked as
  reference only. Failing to read chats never stops a run.
- **Briefings go in `docs/briefings/`** like the app's own, named `YYYY-MM-DD-HHMM-<project>-mc.md`, with the usual
  sections. `/brief` writes one; the banner shows the newest title.
- **Context bar**: the agents report the prompt size of their last turn (Claude input + cache read + cache creation tokens;
  Codex last-turn input tokens) and mc compares it with the model's window (Claude 200k or 1M for `[1m]` models, Codex the
  reported window or 272k). One compact line with both bars sits under the prompt hint, always cut to the terminal width.
- **Resize**: mc repaints the prompt box and live area once a resize has settled (50 ms), clearing what was drawn by counting
  its old widths at the new width; the bottom edge, hint and menu are recomputed on every paint. In the app, xterm fits once
  per animation frame after ~60 ms, not during a panel drag, and the pty only hears about real size changes.

## Consequences
mc remembers a repo across sessions without writing to `~/.claude` or the working tree. The planner prompt grows by the
history and chat digest; `/context` shows how much.
