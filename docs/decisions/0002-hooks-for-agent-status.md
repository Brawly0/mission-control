# 0002: Agent status from Claude Code hooks via `--settings`

**Status:** accepted · 2026-10-20

## Context

Guessing status from terminal output can't tell "waiting for permission" from "done" or "thinking quietly". Claude Code hooks fire on exactly those moments.

## Decision

- Each agent is started with `claude --settings <per-agent file>`. The file adds command hooks that pipe the hook's JSON input to `curl.exe`, which POSTs it to a local HTTP server in the main process.
- The agent is identified by its URL path, not an environment variable, because hook commands may run under bash, cmd or PowerShell, and each expands variables differently.
- New sessions get `--session-id` so restore after a restart can `--resume` the exact chat.

## Alternatives rejected

- **Editing `~/.claude/settings.json`**: it would affect every Claude session on the machine and break the "read-only to Claude's files" rule.
- **Watching the JSONL transcript**: it has no explicit "waiting for permission" signal, and the format is undocumented.
- **Named pipes or a node hook script**: these need a runtime on PATH. `curl.exe` ships with Windows 10 and 11.

## Consequences

- Each hook costs one short curl process (about 30 ms). `PreToolUse` is not hooked, to keep tool calls fast.
- Requires `curl.exe` on PATH. If it's missing, the agent still runs and the status light falls back to output timing.
