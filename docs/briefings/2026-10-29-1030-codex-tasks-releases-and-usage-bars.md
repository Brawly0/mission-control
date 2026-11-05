# Codex session briefing: task teams, guided setup, releases, and restored usage bars

Written October 29, 2026, approximately 10:30 AM, Asia/Hebron. This is a manual handoff requested by the user. It records this Codex conversation, including work retained through compaction. Current Git and release facts were checked again while writing; earlier validation results below are historical results from the session, not freshly rerun checks.

## Resume here

Mission Control is a Windows Electron + React + TypeScript desktop app for Claude Code and Codex projects, chats, agents, tasks, and terminals.

- Workspace: `C:\Users\bsbra\Desktop\claude-hub`.
- Source: private `Brawly0/claude-hub`, branch `main` tracking `origin/main`.
- Public downloads: `Brawly0/mission-control-releases`.
- Current package version: **0.29.1**.
- HEAD and tag `v0.29.1`: **`28ad598485682505928a00140d73d1c68a3b419e`**. Main was pushed and matches origin/main.
- Public release: <https://github.com/Brawly0/mission-control-releases/releases/tag/v0.29.1>. It is published, not a draft or prerelease; published at `2026-10-29T07:46:31Z`.
- Latest completed request: restore the Claude and Codex usage bars at the top quickly. Fixed, tested, and released in 0.29.1.
- No implementation or release work remains from that request. Await the user's next instruction. Do not bump or republish just because you read this briefing.
- Before this document, tracked files were clean. The unrelated **untracked `docs/UI-AUDIT-2026-10-29.md`** belongs to another agent/session. Leave it untouched and do not stage it accidentally.
- This briefing is a new documentation file only; creating it does not change the released source or package version.

**Concurrent-change update during final verification:** Another session began changing task code while this briefing was being written. The final status showed modifications to `src/main/ipc.ts`, `src/main/tasks.ts`, `src/preload/index.ts`, `src/renderer/src/app/useTasks.ts`, `src/renderer/src/components/TaskDrawer.tsx`, and `src/shared/types.ts`, plus untracked `src/main/taskCli.ts`. This briefing did not create, review, test, or alter those files. The released 0.29.1 validation applies to the tagged commit, not these newer uncommitted changes. Preserve them and coordinate with their owner before working in those areas.

Suggested prompt for the next session:

> Read `docs/briefings/2026-10-29-1030-codex-tasks-releases-and-usage-bars.md`, check current Git status, and tell me briefly where things stand. Preserve other sessions' changes. Continue only the work I request.

## User intent and conversation history

The user first asked this session to help another Codex session with a read-only regression/reliability review of uncommitted changes in `src/main/store.ts`, `tasks.ts`, `projectCommands.ts`, `pty.ts`, and `updater.ts`. That request explicitly prohibited editing, version changes, installers, and releases for the review. Subsequent user messages explicitly requested implementation and releases; the initial read-only scope does not describe the later authorized feature work.

The larger sequence was:

1. Review and coordination around the other session's work; the surrounding baseline reached 0.25. This handoff does not reconstruct findings that are no longer available in the retained context.
2. Build a button/workflow that splits a large task into an appropriate team of Claude or Codex agents, wired through backend and frontend. Implemented and released in 0.26.
3. Discuss a Groq-powered prompt generator because the user has a paid API key. A Prompt Studio concept was proposed, but **no key was supplied and no Groq integration was implemented**.
4. Recreate the Home screen from the user's screenshot. Implemented a dense dashboard and released it, with live task terminal work, in 0.27.
5. Recommend a substantial usability task and provide a prompt for the app's task feature. The user ran guided setup / Fix Problems work and a separate UI improvement task inside Mission Control.
6. Inspect a running task and the allegedly empty Terminals tab. Live output was present. The user clarified that they wanted worker agent tabs and a grid **inside Tasks**, like Agents, rather than using the main Agents page.
7. Implement and release the task-owned agent workspace in 0.28.
8. Investigate why an update seemed unreleased. Public 0.28 existed; the installed app was still 0.27. An isolated updater check successfully found and downloaded 0.28. No forced install or restart of the user's running agents was performed.
9. Merge the two completed task branches into current main, resolve conflicts, review and validate the combined behavior, and release 0.29.0.
10. The user reported that the Claude/Codex header usage UI was ruined by the UI changes. Restore the familiar visible bars and release 0.29.1.
11. Current request: document the session and prepare this handoff.

The user prefers concrete action and concise updates, dislikes repeated permission questions, and expects an explicitly requested release to actually become publicly downloadable. Preserve their active agents and concurrent work.

## Delivered: automatic task teams (0.26)

- A planner produces bounded structured plans with 1–6 workers, ownership boundaries, and a dependency DAG.
- A team uses an isolated shared Git worktree. At most three worker processes run concurrently; dependencies and overlapping ownership serialize work where required.
- A final integrator performs checks and commits the task result. Completing a task does **not** automatically merge it into main or publish a release.
- Pause, resume, retry, and cost limits are connected to the team lifecycle. Read-only tasks retain their restrictions.
- Plan parsing/validation lives in `src/shared/teamPlan.ts`, with tests. Backend execution is in `src/main/tasks.ts`; shared task types, preload, IPC, composer, board, and team panel carry the flow end to end.
- Reliability work included lifecycle/finalization/start/queue/merge guard races and stdin EPIPE handling.
- Native team fixtures exercise real local child processes and Git worktrees without paid model calls.

## Delivered: Home dashboard and live task terminals (0.27)

- Home uses the actual indexed SQLite activity data for session statistics, active days, estimated minutes, heatmap, and provider charts. No random or fabricated activity metrics.
- Estimated activity time caps gaps at 15 minutes. Period labels and empty states were later refined by the UI task.
- Five launch cards and a dense two-column, three-row panel layout follow the requested screenshot direction; both themes and narrow layouts are supported.
- Important aggregation code: `src/main/dashboardData.ts` and its tests.
- Task terminal output is tied to actual task-owned processes and retained history, rather than a second set of spawned workers.

## Delivered: agent tabs/grid inside Tasks (0.28)

The user explicitly wanted to see planner, worker, and integrator agents in the Tasks tab, with tabs and grid behavior similar to the main Agents workspace.

- `src/renderer/src/components/TaskAgentWorkspace.tsx`: per-task workspace, task/team selection, tabs, grid, maximization/restoration, keyboard navigation, queued dependency placeholders, and completed output.
- `src/renderer/src/components/TaskTerminal.tsx`: task terminal rendering and ownership behavior.
- `src/renderer/src/taskWorkspace.ts` and its tests: pure workspace selection/state helpers.
- Legacy `TaskTerminals.tsx` was removed.
- Team cards/drawers expose Watch agents and team controls. Starting/resuming a team opens its workspace. A repeated navigation request still focuses the correct terminal through the app's focus request counter.
- Workspace state stays mounted when switching between the board and task workspace. Separate teams keep separate selections. Completed agents retain their output.
- Managed team consoles are intentionally read-only; interactive tasks use a real editable PTY. Shared terminal input ownership prevents one keypress being sent twice.
- Native tests cover queued workers, finished output selection, keyboard navigation, tabs/grid, themes, narrow layouts, and interactive echo exactly once.
- ADR: `docs/decisions/0031-task-agent-workspace.md`; live terminal ADR: `0030-live-task-terminals.md`.

## Delivered: both completed tasks merged into 0.29.0

Original completed task branches/worktrees were preserved:

| Task | Branch / worktree | Task commit |
| --- | --- | --- |
| Guided setup / user friendliness | `mc/agent-e7c6`, `.claude/worktrees/agent-e7c6` | `53b1390` |
| UI improvements | `mc/agent-c242`, `.claude/worktrees/agent-c242` | `0a21ad5fe8673d283b767a95f2fca0ca6685c194` |

Both task commits became ancestors of main. Do not merge them again, delete their worktrees, or rewrite task records merely to tidy up. At the time of inspection their root tasks were done, with team phase review.

### Guided setup and Fix Problems

- Backend `src/main/readiness.ts` checks selected CLI installation, version/authentication, Git, project state, and supported manifests through bounded asynchronous probes.
- Limits: two active jobs, sixteen total jobs, 25-second job deadline, six-second probes, output bounded to 32 KiB, manifest reads bounded to 128 KiB, child process cleanup on cancellation/shutdown.
- PATH discovery rejects relative/local entries. Diagnostics use fixed explanations and sanitized numeric versions. No arbitrary manifest commands are run, no tools installed, and no repository initialized automatically.
- Root `package.json` scripts can suggest npm/pnpm/yarn/bun commands. Other recognized manifests can be explicitly unsupported; this is not a general build-system detector.
- Shared readiness types, request IDs, persistence validation, and problem reconciliation live in `src/shared/readiness.ts` and tests.
- Additive `guidedSetup` store defaults preserve existing profiles. `src/renderer/src/app/useReadiness.ts` owns request identity, cancellation, initial checks, and five-minute refreshes.
- Components: `GuidedSetup.tsx`, `ProjectReadiness.tsx`, `FirstTaskGuide.tsx`, `FixProblemsCenter.tsx`; helper models/tests include `problems.ts`.
- Entry points appear in Home, sidebar, and Settings. Suggested commands remain editable and use the existing Run panel.
- First-task progress follows actual task identity and inspection of current results/diffs. Opening a terminal does not count as inspecting the result. `TaskDrawer` and `ChangesPanel` preserve this distinction and guard against stale asynchronous snapshots.
- Real onboarding fixtures use local fake CLI subprocesses and real UI/IPC/persistence. No paid API credentials or hardware acceleration were proven by these tests.

### UI integration and authoritative connection status

- Task UI changes include responsive sidebar branding/status, searchable suggestions, more consistent project cards, organized Settings, accurate Home periods/empty states, and clearer empty task boards with project filters.
- Merge resolution kept the current Home implementation and the task agent workspace rather than replacing them with older task branch versions.
- `AgentConnections` uses the shared app readiness service. Legacy hub status calls delegate to the same service; there is no second independent diagnostic truth or component polling loop.
- Cached status contains only a timestamp plus installed/logged-in booleans. It is explicitly last-known data and cannot advance onboarding or resolve problems.
- Only definitive readiness/missing-installation/authentication outcomes update the cache. Unselected providers may remain unknown until selected. Failed or partial checks do not manufacture success.
- Shell-only smoke fixtures provide deterministic status without external probes; onboarding uses its real subprocess path.
- Decisions: `docs/decisions/0030-guided-setup-and-readiness.md`, `0032-ui-clarity-and-responsive-layout.md`, and `0033-shared-connection-status.md`. There are two distinct ADRs numbered 0030; both already exist with different filenames.

### Independent review and reliability fix

A read-only reviewer delegated through the cavecrew skill found a concrete P2 cancellation bug: cancelled jobs waiting for the readiness concurrency limit requeued themselves, leaking waiters and undermining the total-job bound.

Fixed by checking `signal.throwIfAborted()` inside the acquisition loop before waiting again. A regression test holds two active jobs, cancels forty queued requests, and checks that no waiters remain. The reviewer independently confirmed the fix. No other high-confidence production issue remained from that review.

## Delivered: restored header usage bars (0.29.1)

The UI task had replaced the full Claude and Codex bars with a compact combined dropdown. The user wanted the old visible bars back quickly.

- `src/renderer/src/components/PlanMeter.tsx` now renders a separate visible provider panel for Claude and Codex within the existing combined component contract.
- Both show Session and Week bars, percentages, warning colors, and forecasts. Countdown text is visible when space permits.
- Prefer actual `five_hour` / `seven_day` windows; if those are unavailable, use an actual reported window instead of inventing a 0% reading.
- Expired Codex windows reset their displayed usage/forecast appropriately. Claude readings older than fifteen minutes are dimmed, with last-good data/error handling retained.
- Empty states honestly say Loading, Retrying, Unavailable, or No limits reported.
- Details open on explicit click or Enter. Automatic opening on hover/focus was removed; Escape/blur/mouseleave closing behavior remains.
- `src/renderer/src/dashboard.css` uses flexible panel sizing; at widths at or below 1650 countdown text hides, and at or below 1100 tracks/padding narrow while the bars and percentages remain visible.
- `src/main/workspaceUiSmoke.ts` asserts four visible header tracks and Week labels for both providers.
- Removing focus-open exposed incomplete Enter simulation in the fixture. The correct sequence is keyDown Return, char `\r`, keyUp Return. That test fix is commit `28ad598`; it was not a product keyboard defect.
- A details-panel sentence may still say “Chip: 5-hour…” from the compact design. This was not a blocker and is not an instruction to expand scope on resume.

## Commits and release evidence

Recent main history:

| Commit | Purpose |
| --- | --- |
| `28ad598` | Complete Enter event sequence in usage details smoke test; v0.29.1 tag |
| `e08d41b` | Restore visible provider usage bars; package 0.29.1 |
| `71bd656` | Confine release fixture processes to their isolated working folders; v0.29.0 tag |
| `e416390` | Atomically wait for and click enabled onboarding controls |
| `0482a9b` | Prepare 0.29.0 with combined guided setup and UI improvements |
| `6b8e58b` | Merge UI task with shared readiness diagnostics |
| `556c3e3` | Merge guided setup/readiness task |
| `83cc25d` | 0.28 task-owned agent workspace |
| `41aad21` | 0.27 Home and live task terminals |

Published 0.29.1 assets, checked again while writing:

| Asset | Bytes |
| --- | ---: |
| `latest.yml` | 362 |
| `Mission-Control-Setup-0.29.1.exe` | 113589996 |
| `Mission-Control-Setup-0.29.1.exe.blockmap` | 120559 |
| `SHA256SUMS.txt` | 99 |

Installer SHA-256: `f87f95d0d58d7b8503f9bb97813c1ae0f133be14de4b9bf3d6d6f37fa720d941`.

At release time the public latest endpoint, downloaded `latest.yml`, downloaded checksum, local installer hash, and GitHub asset digest agreed. Verification downloads are in ignored `out/public-release-0.29.1`. Rechecking the tagged release is not proof that a future latest release remains 0.29.1; query latest again if investigating later.

Historical validation for the final 0.29.1 source/package:

- **323 tests passed**, plus TypeScript checks and production build.
- Windows CI run **40837025331** succeeded on the final source commit before publication.
- Native development shell proof: `out/combined-shell-20261029-094120`.
- Native packaged shell proof: `out/combined-shell-20261029-094258`; dark/light themes at 1440 and 960 widths.
- Packaged release gates: `out/release-check-d6uH9h`; package contents, startup, process/shutdown cleanup, and actual installer download through the updater passed.
- Release notes: ignored `out/release-notes-0.29.1.md`.
- These proofs do not establish that the user's currently running installed app has restarted into 0.29.1.

0.29.0 was also published with all four assets. Its installer SHA-256 was `3c4c2c175a05a8f35396b53bc45f6138bc2728489c2fe363b209f7cd5b42bb90`. The broader combined feature validation covered onboarding and a separate-process restart, workspace, polish, Home, team, Run, and Codex task fixtures, along with 323 tests and typecheck/build.

## Release and native-test pitfalls learned here

1. **Publishing and updating are separate.** The user previously had 0.27 installed while 0.28 was already public. Automatic polling is about thirty minutes; Settings → Updates → Check now is the immediate route. Do not kill active agents or restart the app without the appropriate user intent.
2. **An isolated app profile does not fully isolate the updater cache.** An installed-binary smoke check downloaded 0.28 to the normal local updater cache. It did not install it. Do not assume a pending cached installer reflects the newest source version.
3. **Avoid overlapping native GUI tours with release gates.** Concurrent packaged feature tours and gate runs caused startup timing failures in this session. Sequential reruns passed. Do not diagnose an app regression from a single overloaded native harness run.
4. **Atomically locate and click enabled controls.** A prior onboarding test treated a missing button as enabled through optional chaining, or raced React's automatic check between lookup and click. The helper now waits and clicks in one renderer evaluation.
5. **Keep fixture working directories isolated.** A fake Claude authentication subprocess wrote `agent.txt` into the repo because its cwd was the repo. `scripts/check-release.mjs` now starts each fixture in its own test directory and passes an absolute project path to development Electron. The verified fixture-only `agent.txt` was removed; no user file was deleted.
6. **Check log assertions as well as exit codes.** Native Electron can exit zero after a logged `FAILED`. Require completion and expected PASS markers, and reject any FAILED marker.
7. **Native Enter often needs the char event.** Focus previously masked the incomplete keyboard fixture. Use the complete keyDown/char/keyUp sequence when applicable.
8. **Packaged code matters.** Compare/test the built package, not just source. Windows `asar.extractFile` paths needed native separators (`path.join`) in manual payload checks.
9. **Do not unnecessarily rebuild an uploaded installer after a gate-only failure.** If payload/source are unchanged, fix the harness/environment, rerun gates, and finish checksum upload/asset verification for that same payload. Never silently replace an already published release.
10. **Do not use broad staging or cleanup.** Other agents share the folder. Stage explicit files and preserve untracked audits, task worktrees, and active processes.

## Reproducible verification and release workflow

Normal source checks, when code changes justify them:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Use `npm.cmd` when PowerShell execution policy rejects `npm.ps1`.

An ignored helper from this session is available at `out/check-combined-tasks.ps1`. It clears inherited `MC_SMOKE*` and `ELECTRON_RUN_AS_NODE`, creates an isolated profile/log/screenshot directory, launches hidden, waits, and checks logs and exit status.

```powershell
& .\out\check-combined-tasks.ps1 -Scenario SHELL
& .\out\check-combined-tasks.ps1 -Scenario SHELL -AppExe "$PWD\release\win-unpacked\Mission Control.exe"
& .\out\check-combined-tasks.ps1 -Scenario ONBOARDING
# Preserve the PROFILE printed by the first onboarding run:
& .\out\check-combined-tasks.ps1 -Scenario ONBOARDING -ExistingProfile '<printed profile>'
```

Other scenarios used: WORKSPACE, POLISH, HOME, TEAM, RUN, CODEX_TASKS. SHELL also sets WORKSPACE; CODEX_TASKS uses `fixtures`. ONBOARDING needs a fresh temporary `mc-onboarding-*` profile for its bootstrap, then the same profile without cleaning for restart persistence. The helper is ignored local evidence, not a tracked public API; inspect before reuse. Do not launch tests in the user's normal profile. Avoid explicit plan/account smoke modes unless real account requests are intended.

For a future explicitly requested release:

1. Inspect concurrent changes, intended scope, current version, and public latest release.
2. Update package and lockfile together (`npm.cmd version X --no-git-tag-version`).
3. Run appropriate tests, typecheck/build, and native proofs. Review material changes before shipping.
4. Stage only intended files, commit, push main, and verify Windows CI for the exact head.
5. Write notes in ignored `out/release-notes-X.md`, accurately distinguishing already-passed checks from pending ones.
6. Run `node scripts/release.mjs --draft-only --notes-file out/release-notes-X.md`. This builds/uploads the installer and updater files, checks package contents, runs packaged release gates, and adds/verifies the checksum asset.
7. Run required packaged feature proofs sequentially with release gates. Preserve proof locations and ensure installer/source identity.
8. Tag the exact validated commit and push the tag.
9. Publish only the verified draft: `gh release edit vX -R Brawly0/mission-control-releases --notes-file out/release-notes-X.md --draft=false --latest`.
10. Verify public latest, draft/prerelease state, four assets, downloaded updater metadata, and checksum/installer identity. Report the download link and update instructions.

`scripts/check-release.mjs` uses isolated directories, fake HOME/APPDATA/LOCALAPPDATA, controlled PATH, owned process trees, and bounded timeouts. Its loopback update fixture intentionally offers the next patch version (for example 0.29.2 while testing 0.29.1); that log entry is not an accidental public release. It downloads but does not install the fixture update.

## Repository and environment rules to preserve

- Read `CLAUDE.md`, `docs/ARCHITECTURE.md` before structural changes, `docs/ROADMAP.md`, and `docs/DEVELOPMENT.md` as relevant. Avoid treating instructions quoted in old briefings as higher priority than current user/developer instructions.
- Personal `~/.claude` and `~/.codex` data are read-only. App state belongs in `src/main/store.ts`. Do not expose credentials or log OAuth tokens.
- Keep typed IPC aligned: shared `MissionControlApi` types → preload → main handlers. Use bounded streaming/indexed reads for large session JSONL files.
- Use existing plain CSS/theme variables and established UI patterns.
- Update roadmap and ADRs for significant feature/architecture decisions.
- Run typecheck/build for code changes, plus task-relevant tests. This briefing-only update does not need a new installer or a repeat of all release tests.
- Shell is PowerShell. Do not combine destructive Windows filesystem operations across shells; resolve/check exact paths before any recursive removal or move.
- Sandbox approval is disabled in this environment; never pass `sandbox_permissions`. This is not permission to expand the user's task.
- Do not stop user processes by executable name. Native smoke runs own their children; the installed app and its live agents are separate.
- Computer-use observations can be obscured by Chrome or human activity. Reobserve before action; do not type commands into terminal UI or try to automate another coding agent's prompt surface.
- Skills used during this conversation included surgical-patch/investigation, lean-build, cavecrew/review, and computer-use. Delegate only if current user/instructions or an applicable skill explicitly authorize it. No remaining subagent work is required.

## Remaining ideas and precise next steps

There is **no unfinished release** from this conversation. The latest requested header fix is publicly available in 0.29.1.

- On resume, inspect Git status first. Expect this new briefing, the unrelated UI audit, and the concurrent task changes listed above unless their owning session has committed or changed them since writing.
- If the user still sees the compact header, confirm the installed/running version and update state before editing source. Use Settings → Updates → Check now and a user-timed restart.
- If the user asks for Groq Prompt Studio, treat it as new feature work. The discussed direction was backend-held API credentials, structured prompt generation, editable output, and an explicit handoff to task creation. No API key or implementation should be assumed to exist.
- If asked for another usability task, read the other session's UI audit rather than assuming its findings are already fixed or approved.
- Otherwise await the next task. Preserve both completed task worktrees and unrelated concurrent changes.
