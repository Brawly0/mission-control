# 0028: Task-sized agent teams

Date: 2026-10-27

## Entry and planning

New task offers **Split into agents** directly below the prompt. An unstarted task also offers it beside Start in its drawer. The selected provider (Claude or Codex) inspects the project in read-only mode through the existing tracked headless runner. The reply must be a bounded JSON plan with one to six scoped assignments and an acyclic dependency graph. Small tasks should use one worker, rather than filling a fixed team size. Invalid output leaves an actionable planning error and can be retried.

The original task owns the plan and controls. Its panel previews every assignment, file ownership, dependencies and the final integration stage before **Start N agents**. Planning uses the selected provider's account; it is an actual model call. Teams require a git repository with an initial commit. Planning does not create a worktree, edit project files, commit or run project checks.

## Execution and integration

The main process creates one isolated worktree for the whole team and stages all member records before launching any worker. The team scheduler runs at most three background agents, respects provider plan limits and project budgets, and serializes assignments with overlapping file/directory ownership. Explicit dependencies must succeed first. Ownership is a scheduling rule and an instruction to the CLI, not a separate per-file OS sandbox. Workers inherit the original task's permissions and provider/model, and receive completed dependency handoffs.

Workers share the same checkout so dependent agents see previous work and the integration stage receives every worker's changes. Each worker is told to keep to its owned paths, preserve other workers' edits, and avoid commits, merges and further delegation. Workers do not trigger automatic commits or project checks. The final integration agent starts only after every worker succeeds; it receives all worker handoffs, fixes integration issues and verifies the original goal. Mission Control then runs the configured project checks and commits the combined work only if they pass. Read-only teams skip automatic checks and commits. There is no automatic merge, release or publication.

The existing git IPC actions reject commit, merge and discard of an unfinished team's worktree, including from other project views. Finished changes use the normal review and merge flow. To abandon unfinished work, pause and delete the original task first, then use the normal discard action.

## Persistence, failure and budgets

Parent and member records use the existing task store, event subscription and runner. The board, Home, sidebar and digest count the original task once; the team panel links to each member's live activity and results. Individual member runs cannot be manually edited, started, continued or deleted outside the team controls.

Pause stops the tracked process trees and prevents pending starts. A failed member stops its peers and pauses the team. Resume retains successful assignments, retries interrupted/failed assignments with their saved scope, and reuses the same worktree. Finalization remains tracked while checks/commit are pending, so resume/delete cannot race a finishing integrator. On app restart, interrupted teams become paused and planning attempts become retryable errors; no team silently restarts.

For Claude, the task's explicit cap (or the app default) becomes a total team cap including planning and retries. The scheduler reserves per-agent allowances from the unspent balance. Previous-attempt reported costs remain in the ledger; a paused team's cap can be changed or removed. Codex uses its existing plan and has no fabricated USD costs/caps. Model-reported spend and CLI cap behavior retain the same practical limits as ordinary tasks.

## Verification

Pure tests cover bounded JSON parsing, unsafe ownership paths, duplicate ids, dependency validation and scope overlap. Mocked runner tests cover both providers, parallelism, dependency handoffs, failures, retry cost accounting, read-only teams, shutdown, restart recovery and pending finalization. `MC_SMOKE_TEAM=1` exercises the real UI, typed preload/IPC, child-process streams, shared worktree and final checks/commit using a local fake CLI with no model calls. It captures dark/light layouts at 1440 and 960 pixels, parent/member navigation and the composer button.
