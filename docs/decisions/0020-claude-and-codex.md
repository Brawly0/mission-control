# 0020: Claude and Codex side by side, with handoffs

**Status:** accepted · 2026-10-27

## Context

You want to use the Codex CLI next to Claude Code on the same projects, and to switch between them mid-task: finish with Claude, give Codex the next task, and have Codex know what Claude did (and the other way round). Both need to be clear in the UI, and Codex usage needs tracking like Claude's.

What Codex 0.164 (installed with `npm i -g @openai/codex`) offers, checked on this machine:
- **Chats** are JSONL "rollouts" in `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. The first line (`session_meta`) has the id, folder (`cwd`) and git branch. Prompts and replies are `response_item` messages, shell commands are `item_completed` events of type `CommandExecution`, and patches are `apply_patch` text inside tool calls. Codex names its chats in `~/.codex/session_index.jsonl`.
- **Usage**: every `token_count` event carries the chat's running token totals and the plan limits (`primary` = 5-hour, `secondary` = weekly, `used_percent`, `resets_at`, `plan_type`).
- **Status**: the interactive CLI writes its state into the terminal as OSC 7501 (`state=idle|working|done|blocked:app=codex[:kind=permission]`). Nothing to configure.
- **Hooks** exist (same events as Claude's), but hooks passed with `-c` for one run don't fire without `--dangerously-bypass-hook-trust`, which would also skip the trust check on hooks a repository brings. Not used.
- **No session id up front**: unlike `claude --session-id`, the id is only known once the rollout file exists (Codex creates it at startup). Resume is `codex resume <id>`.
- A folder Codex hasn't seen shows a **"Trust this folder?"** screen first, before any state signal.

## Decisions

- **Codex is a third agent kind** (`'codex'` next to `'claude'` and `'shell'`). It runs in the same terminal host. `pty.ts` finds `codex` on PATH like `claude`; when it's missing, the tab says how to install it.
- **Status from OSC 7501**, parsed in `terminals.ts` and sent as `hook:event` (`CodexState`), so Codex uses the same status lights, notifications, inbox and "your turn" as Claude. The trust screen is spotted by its text and shown as "needs you".
- **The chat id is found, not assigned.** After a new Codex agent starts, `findNewCodexSession` looks for the newest rollout in that folder created since the launch and not claimed by another open agent. Restore and workspaces then reopen it with `codex resume <id>`.
- **One chat list.** `listSessions` adds Codex chats from the same folder and its worktrees, marked `tool: 'codex'` (`projectKey: 'codex'`). The viewer, recap ("what we worked on"), rename and Summarize work for them. Listings read only the head and tail of each file, like Claude's (they can grow large).
- **Handoffs are free files, not model calls.** "Continue in Codex / Claude" (chat viewer, the agent's header button, the project's New menu, the palette) writes `docs/briefings/<time>-handoff-<from>-to-<to>.md` (the app's own briefings folder for non-project folders). It contains the rules files to read first, what the user asked, files changed, commits, commands, git's branch, uncommitted changes and commits since the chat began, the last reply, the latest messages and the transcript path. The other agent starts in the same folder (or worktree) with the same kind of prompt as "start from briefing". Putting it in docs/briefings means both agents can read it without sandbox or permission prompts, and "New session from latest briefing" picks it up too.
- **Shared rules.** Claude reads CLAUDE.md, Codex reads AGENTS.md. The project Overview offers to add an AGENTS.md that points to CLAUDE.md (never overwriting one), so one file holds the rules for both.
- **Codex usage** comes from the rollouts: the newest limits go in the top bar next to Claude's (each labelled once both show), and on the Usage page Codex's card sits beside Claude's plan limits, with tokens by project and model. Tokens, not dollars: there's no per-token price on a ChatGPT plan. A chat's tokens count on the day it was last active, because the files hold running totals. Codex only reports limits while it runs, so the meter isn't dimmed when old, and a window whose reset has passed counts as empty.
- **Read-only.** Nothing in `~/.codex` is written, the same rule as `~/.claude`. The self-test trusts its scratch folder for one run with `-c projects=…`, not by saving it.

## Not done (yet)

- Codex in headless tasks (`codex exec --json`), chains and the queue.
- Codex chats in full-text search (the index is Claude-only).
- Send to several agents stays Claude-only.
- Folders used only by Codex don't appear as projects on their own; add them with + in the sidebar.

## Consequences

- Handoff files add up in docs/briefings, like briefings do. They're small and dated.
- If Codex changes its rollout format or the OSC 7501 signal, Codex chats or lights degrade (unknown lines are skipped, and the light falls back to output timing). `MC_SMOKE_CODEX` checks both against the installed CLI.
