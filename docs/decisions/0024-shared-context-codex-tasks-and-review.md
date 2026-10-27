# 0024: Shared context, Codex tasks and source-bound review

Date: 2026-10-27

## Shared project context

`docs/BRIEFING.md` is the editable project-level context for both agents. Generating a refresh previews recent chats, open tasks, project command results and git state without writing. Saving is explicit. Text above the generated marker preserves the user's goal, decisions and next steps. New empty interactive sessions, fresh tasks and cross-agent handoffs refer to the saved briefing. Existing resumed conversations keep their current context. No model call is needed to generate the draft.

## Codex tasks and search

Tasks and templates have an optional `tool`, defaulting to Claude for compatibility. Codex uses `exec --json` with prompts on stdin, and `exec resume` for follow-ups. Stream events update the existing task lifecycle; queues, dependency checks, worktree isolation and notifications are shared. Pipeline steps can choose their own agent and read-only review mode. Switching agents between steps clears the other provider's model and USD cap.

Codex background tasks use workspace-write with approval policy never, plan/review tasks use read-only, and the existing explicit bypass selection is retained. USD task caps are unsupported by the CLI: the UI only offers them for Claude and the backend rejects a Codex task with a cap. Claude's model defaults, Eco flags and cost estimates are not applied to Codex. Queue holds consult the selected provider's limits.

The existing SQLite worker incrementally indexes Codex user/assistant message records. It reuses the offset/mtime cache and FTS tables, keeps incomplete lines for the next pass, and records no fabricated API costs. Search labels and resumes the correct provider. Opening a result from a project not yet listed adds its existing folder to the app.

## Review and merge

Changes shows the diff, project checks and read-only agent findings together. A fingerprint covers git HEAD, the diff and changed-file metadata. Check commands and reviewer runs retain that fingerprint. Results become stale when source changes; check configuration changes also invalidate checks. The user's review checkbox is tied to the current source and result identities.

The review UI calls a merge endpoint that rechecks the fingerprint and configured passing checks immediately before using the existing safe git merge. Automated review results do not approve a merge. Tests cover rejected stale reviews/checks and a successful checked merge in a temporary worktree.

## Efficiency

Terminal output schedules one idle transition per active stream rather than rerendering the app every second. Closed menus do not measure layout, new command/briefing UI loads on demand, and hidden project panes defer transcript loading. Measurements on this machine recorded idle CPU with four shells dropping from 1.0% to 0.5% in Agents and 0.8% to 0.4% on Home. These are samples, not guaranteed results on other systems. The performance harness disables Windows background timer throttling so startup probes are not delayed by occlusion.

Final run with the corrected startup probe: first project visible at 941 ms; 115 chats / 8,791 indexed messages. Idle samples were 0.2% CPU / 407 MB with no agents, 0.4% / 549 MB with four shells in Agents, and 0.3% / 595 MB with four shells on Home. Memory includes the browser, renderer, GPU, network service and terminal host; working sets varied across runs.
