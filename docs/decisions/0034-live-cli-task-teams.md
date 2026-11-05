# 0034: Interactive CLI conversations inside task teams

Date: 2026-10-29

## Context

The existing task-agent workspace displays background CLI events in a read-only console. Users need the actual Claude/Codex terminal to watch progress, answer approvals and converse with each worker, as they can with standalone agents. Interactive CLIs remain open after replying, so process exit cannot signal successful assignment completion.

## Decision

Both Split into agents entry points default to Live CLI. The structured, read-only planner still uses the background runner to produce a validated assignment plan. Workers and final integration use the existing terminal host and TerminalPane, owned by the main-process coordinator. The Tasks workspace can show the whole team in Grid or individual agents in Tabs. Navigation only mounts views of existing terminals; it never starts another session. A completed planner remains accessible by its tab but recedes from the live grid.

TaskTeam.mode records the execution choice. Existing teams and calls that omit the mode retain their background behavior. Background mode remains available for unattended execution and enforceable Claude USD caps. Live mode explicitly states that those caps are not enforced; its planner and members receive no inherited cap. Other automation holds remain in place.

Users converse directly in a live CLI and choose Finish assignment after the CLI reports its completed reply. Authoritative Claude hooks and Codex OSC states determine readiness; output silence and initial idle do not. The Stop hook's final reply is preferred for Claude because transcript flush can lag the hook; older versions fall back to a streamed transcript read. Codex handoffs come from the session rollout, excluding commentary and older turns. Handoffs are bounded to 24,000 characters. Long prompts and predecessor handoffs are written in the app's own task-assignment directory and referenced by a short first message, avoiding Windows command-line length limits.

Finish assignment captures the handoff, closes and waits for the actual PTY exit, then runs the existing settlement path. Only the integrator runs the project checks and commits combined changes. Pausing, unexpected exit and shutdown never count as success. A pause during reply capture cancels completion and closes the CLI. Dependencies, overlapping ownership, the three-agent limit and shared worktree guards include live PTYs. Result/changes review evidence requirements remain unchanged.

## Verification

Coordinator regressions cover provider selection, handoffs, explicit completion, follow-up readiness, unexpected exit, unavailable replies and cancellation during reply capture. Adapter tests cover event routing, actual-exit waiting, long assignment transport and result extraction. MC_SMOKE_TEAM=live runs a fully isolated native fixture tour for Claude and Codex: real PTYs, typed follow-ups arriving exactly once, stable terminal IDs across navigation, worker/integrator completion, project checks/commit, dark/light themes and 1440/960 widths. No model calls or user transcript/configuration writes are needed. Background-team coverage remains under MC_SMOKE_TEAM=1.

## Limits

A stopped older team can be converted and resumed through the guarded startup argument `--resume-task-team-in-cli=<task UUID>`. Prerequisites and idle ownership are checked before conversion. The coordinator retains plan/member IDs, successful results and the existing worktree, changes only unfinished assignments to interactive mode, and uses the ordinary resume scheduler. A regression covers preservation and duplicate-start rejection. This command must be used when starting a stopped application, rather than sent to an already-running instance.

The planner remains read-only background output. Live teams require the user to release each completed assignment, so they are intentionally supervised rather than unattended. Completed assignments close their CLI before downstream work starts. After an app restart, live team runs are marked interrupted and the team is paused; resuming restarts unfinished assignments using saved scope and handoffs. Installed releases do not receive source changes until rebuilt and distributed.
