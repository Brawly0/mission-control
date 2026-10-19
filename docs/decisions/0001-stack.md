# 0001: Electron + React + xterm.js + node-pty

**Status:** accepted · 2026-10-20

## Context

The app must host several real, interactive `claude` CLI sessions at once on Windows, read large local JSONL files, and look good.

## Options

| Option | Embedded terminals | Notes |
|---|---|---|
| **Electron** | node-pty + xterm.js, the same stack as VS Code | Larger install (~150 MB) |
| Tauri | Needs a Rust PTY crate and a custom bridge | Smaller binary, more glue code |
| WPF / WinUI | No mature terminal control | Windows-native look, slow UI iteration |
| Python + Qt | Weak ConPTY support | Hard to package |

## Decision

Electron, built with electron-vite, React 19 and TypeScript. Terminals use `@xterm/xterm` and `@lydell/node-pty`, a node-pty fork that ships prebuilt N-API binaries, so no Visual Studio Build Tools are needed and it works across Electron versions.

App data is a JSON file for now; SQLite comes in when full-text search is added (roadmap v0.4).

## Consequences

- Terminals behave exactly like Windows Terminal (ConPTY), including Claude Code's interactive UI.
- Install size is larger than Tauri. That's acceptable for a personal desktop tool.
