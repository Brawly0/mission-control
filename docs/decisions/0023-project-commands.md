# 0023: Project commands

Date: 2026-10-27

Saved PowerShell commands live in `ProjectMeta.commands` through the existing metadata store. The project's Run tab saves and launches commands, shows live output and exit status, and offers Stop, Copy, Ask Claude and Ask Codex.

The main process owns each child process and its latest result. Output is capped at 64K characters and updates are throttled per run; switching projects or views keeps commands running. Only one run of a saved command can run at once. Stop terminates the process tree, and app shutdown stops all command processes. Running commands count as work for close-to-tray. Results are session-local; saved command definitions survive restart.

Agent requests write the command and its output to an app-data Markdown report and pass a short read-file prompt. This avoids Windows command-line length limits and preserves the exact captured result. Commands run only when explicitly launched. No project scripts or environment files are modified automatically.
