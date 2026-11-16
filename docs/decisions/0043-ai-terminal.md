# 0043: AI terminal: activity strip, approval bar and prompt box

Date: 2026-11-16 · Status: superseded by 0044 (reverted in 0.38.0)

## Context

Agent terminals were a bare xterm: a 6-colour theme, the DOM renderer, no links, and nothing around the terminal
that knew an AI was running in it. The user: "it doesn't feel like an AI terminal at all".

## Decision

**Rendering** (`TerminalPane.tsx`)
- The full 16-colour palette, taken from the brand colours. A bar cursor in Electric Cyan, line height 1.15.
- The GPU renderer (`@xterm/addon-webgl`). If the context is lost (too many terminals, a driver reset), it falls back to the DOM renderer.
- Unicode 11 widths (`@xterm/addon-unicode11`), so emoji and symbols don't shift Claude's layout.
- Web links open in the browser (`@xterm/addon-web-links`).
- File paths in the output (`src/App.tsx:42:7`, `main.ts(12,3)`) open in VS Code at that line (`code -g`). `shared/terminalLinks.ts` finds the candidates. The main process (`fs:files-exist`) confirms the file exists before a path becomes a link, so words that only look like paths never link.

**Activity strip** (`AgentAssist.tsx`)
- The hook settings now also send `PreToolUse`. The hook server describes every tool call (`shared/agentActivity.ts`: "Editing App.tsx", "Running npm test").
- The renderer keeps `agent.activity` (set at PreToolUse, cleared at PostToolUse, so the strip reads "Thinking" between tool calls) and `agent.edited` (files from successful Edit/Write calls).
- The strip shows a live timer and an "N files changed" chip that opens the Review panel.
- Codex and mc have no tool hooks, so they show status only.

**Approval bar**
- A permission prompt shows Allow / Deny / More, with the pending command.
- The buttons type the CLI's own keys:
  - Claude: Enter (the menu starts on "Yes"), Esc (No).
  - Codex: `y` / Esc. Trust screen: Enter.
- "More" focuses the terminal for the other options. The bar hides after an answer until the status changes again.
- The keystroke approach was chosen over the `PermissionRequest` hook. That hook would mean holding an HTTP request open past curl's 3-second limit, and keystrokes leave the terminal's own menu as the source of truth.

**Prompt box**
- Under Claude and Codex terminals (not shell or mc).
- Enter sends through `sendPrompt`, so a multi-line prompt goes in as one bracketed paste and Enter follows as a separate keystroke. Shift+Enter adds a line.
- ↑/↓ walk past prompts (localStorage, last 100).
- Esc clears the box. Esc in an empty box interrupts the agent. Enter in an empty box sends Enter, for TUI menus.
- Pasted images are saved as PNGs in `%TEMP%\mission-control-paste` (cleared after a day) and inserted as paths. Dropped files go in as `@relative` paths for Claude.
- Quick commands: Claude gets /compact, /clear, /context, /model. Codex gets /compact, /new, /status, /model. A Stop button appears while the agent is working.
- The box takes focus when the agent is shown. It can be hidden from the strip (`mc.composer`).
- Typing straight into the terminal still works.

## Consequences

- `PreToolUse` doubles the hook calls per tool. Each is a local curl that answers `{}` immediately, so it never blocks a tool.
- Each visible terminal holds a WebGL context. Chromium caps contexts at about 16, and the oldest falls back to the DOM renderer.
- `MC_SMOKE_TERM=1` tests all of this with a fake `claude` on PATH and made-up hook events, with no model calls. The fake turns on bracketed paste, as the real CLI does. Without that, ConPTY strips the paste markers.
- Not seen yet with a real Claude session: the exact keys in Claude's permission menu across versions. Also unchecked: paths Claude prints that wrap across lines (they don't link).
