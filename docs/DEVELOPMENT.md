# Development

## Setup

```bash
npm install
npm run dev
```

`npm install` runs a `postinstall` step that downloads the Electron binary. If `npm run dev` says Electron failed to install, run:

```bash
node node_modules/electron/install.js
```

## Checks

```bash
npm run typecheck
npm run build
```

### Smoke test

Builds aside, the app has a self-test that scans your projects, runs `claude --version` in a real PTY, screenshots the window and quits:

```powershell
npm run build
$env:MC_SMOKE = "$PWD\smoke.png"; .\node_modules\electron\dist\electron.exe .
```

Expected output: `[smoke] projects: N`, the session count of one project, the Claude Code version from the PTY, and the screenshot path.

## Conventions

- TypeScript strict everywhere. Shared types live in `src/shared/types.ts`.
- Never write to `~/.claude`. App data goes in `store.ts`.
- New IPC: add to `MissionControlApi`, then `preload/index.ts`, then a handler in `main/ipc.ts`.
- Styles: plain CSS with variables in `renderer/src/styles.css`. No UI framework.
- Record significant choices in `docs/decisions/NNNN-title.md`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Terminal says "claude was not found on PATH" | Install Claude Code, check `where claude`, restart the app |
| A project shows a strange path | The real path is read from session files. Folders with no readable session fall back to decoding the folder name, which is lossy. |
| Agents fail with "OAuth session expired" | Log the CLI in with `claude auth login` in a normal terminal; `claude auth status` should show `"loggedIn": true`. The desktop app's login is separate. |
| Chat list is slow the first time | Large session files are scanned once, then cached by modification time |
| A headless task stops right away with a permission message | The task's permission mode refused an action. Pick "Auto" or "Accept edits", or run it Interactive to approve things yourself. |

### Hook test

`MC_SMOKE_HOOKS=<empty folder>` makes the smoke test also send one tiny real prompt (`claude -p`) from that folder and list the hook events that reached the app. Expected: `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`, all with the session id the app assigned. This uses a small amount of your Claude usage and needs `claude` to be logged in. Set `MC_SMOKE_MODEL=haiku` to use a cheaper model.

### Project commands test

`MC_SMOKE_RUN=1` exercises the Run tab using a temporary project and real PowerShell commands, with no model calls. It checks saving a command, streamed output, duplicate prevention, results across page changes, exit codes, stopping, bounded output and a diagnostic report for an agent. Use `MC_SMOKE=<output.png>` as usual. Project metadata is restored in the isolated self-test profile.

It also checks shared briefing preview/save/refresh, preserving manual decisions, check freshness after source edits, and guarded merges in a temporary git worktree. Final UI checks exercise the review summary, Codex task controls and the shell working-to-idle transition.

`MC_SMOKE_CODEX_TASKS=1` runs a short real Codex background task and resumes its session, then checks dependencies, mixed-agent templates, rejection of unsupported USD caps, and incremental Codex full-text indexing using fixtures. Use `MC_SMOKE_CODEX_TASKS=fixtures` to run the UI/template/search portion without model calls. Existing sessions/configuration are read-only; the CLI creates its own ordinary task session files.

`MC_SMOKE_CODEX_TASKS=review` runs a real read-only Codex review against a tiny temporary git diff, checking tool activity, the final result and that the reviewer leaves source unchanged.

### Codex test

`MC_SMOKE_CODEX=<scratch git repo with a CLAUDE.md>` opens a Codex agent there with a short read-only prompt and checks: the status lights (working, then done), the chat id the app finds, the chat in the project's list, its recap, Codex usage and limits, the chat viewer, and the agent's **→ Claude** button (it writes the handoff and starts Claude). Screenshots `<MC_SMOKE>-codex-*.png`. Uses one short Codex turn and starts one Claude agent. The folder is trusted for that run only (`-c projects=…`), so nothing is saved to `~/.codex`. Claude will show its own "trust this folder" screen for a new scratch folder; that's expected.

### Projects and connections test

`MC_SMOKE_WORKSPACE=1` checks the sidebar's agent connections, project rename and drag sorting, and the Agents bar's **Terminal** button. It verifies the dock opens PowerShell in the active folder, keeps the same shell alive while collapsed or on another page, resizes and closes, and fits dark/light and narrow layouts. It also checks grouping across two projects and selecting tabs through the overflow menu. It needs the claude-hub project in your list and restores project metadata and theme afterwards. Screenshots use `<MC_SMOKE>-connections/project-menu/projects/sidebar-rename/dock-dark/dock-light/dock-narrow/agent-switcher.png`. No model calls.

### UI tour and worktree test

`MC_SMOKE_UI=<git repo with at least one commit>` screenshots Home, the project tabs, the command palette and the Agents grid with the review panel (as `<MC_SMOKE>-<name>.png`). It also runs the worktree flow on that repo: create, change a file, commit, merge into the base branch, stop the agent, delete. Use a throwaway repo, because the test merges into it. The repo is shown as a project only while the test runs.

### UI polish tour

`MC_SMOKE_POLISH=1` tours Home, Projects, Tasks, Search, Usage and Settings in dark/light themes at 1440 and 960 pixel window widths. It checks page/header overflow, real menu keyboard navigation and focus return, upward placement at the bottom edge, search progress/empty states, switching and cancelling document edits, and Settings at 125% zoom. Screenshots use the `MC_SMOKE` filename with descriptive suffixes. No model calls or changes to project files; settings are restored in the isolated self-test profile.

## Packaging

`node scripts/check-release.mjs --dev` runs clean-profile first-run and process cleanup gates without model calls. After building the installer, `node scripts/check-release.mjs` runs the same gates against `release/win-unpacked/Mission Control.exe`, validates its update manifest and downloads the real installer through a temporary loopback update feed. Tests use isolated history/settings/cache folders under `out/release-check-*`; downloaded updates are never installed by self-tests.

`scripts/check-installer.ps1` exercises install, upgrade and uninstall using separate `MissionControlInstallCheck` installers under `out/install-check-old` (0.24.99) and `out/install-check-new` (the release version). Build these with a distinct appId (`com.brawly0.missioncontrol.installcheck`), productName (`MissionControlInstallCheck`), extraMetadata.name (`mission-control-install-check`), matching shortcutName and nsis.runAfterFinish=false. Keep normal per-user NSIS settings, including deleteAppDataOnUninstall=false. This prevents interference with the daily-use install. The script verifies executable replacement, preserved fixture data and shortcut cleanup.

`npm run publish-release -- --draft-only --notes-file <notes.md>` builds, uploads and validates a draft without publishing. Review it, then publish with GitHub CLI. The ordinary command publishes after the same gates pass. Every release includes SHA256SUMS.txt alongside the installer, blockmap and latest.yml. The source repository remains private; `Brawly0/mission-control-releases` is the public download repository.

`npm run dist` builds `release/Mission Control Setup <version>.exe` with electron-builder (NSIS, one-click, per-user). The app icon is `build/icon.svg`; run `npm run icon` after editing it to regenerate `build/icon.png`, which electron-builder turns into the `.ico`.

To test a packaged build without installing it, use the smoke test on `release/win-unpacked/Mission Control.exe`. A packaged Windows app has no console, so set `MC_SMOKE_LOG=<file>` to get the log:

```powershell
$env:MC_SMOKE = "$PWD\smoke.png"; $env:MC_SMOKE_LOG = "$PWD\smoke.log"
& ".\release\win-unpacked\Mission Control.exe"; Get-Content smoke.log
```

### Task test

`MC_SMOKE_TASKS=<git repo with a commit>` runs one real headless task (Haiku, in a worktree, $0.20 budget) through the board. It checks the activity, cost and result, confirms the file it wrote in the worktree, screenshots the board, the task panel and the New task dialog, then deletes the task and its worktree. A run costs about $0.03.

## Releasing an update

Installed copies update from the public repo [Brawly0/mission-control-releases](https://github.com/Brawly0/mission-control-releases). It holds only installers; the source stays in this private repo.

1. Bump `version` in `package.json` (for example 0.6.0 → 0.6.1). Auto-update only offers a higher version.
2. Publish (uses your `gh` login for this run only):

   ```powershell
   npm run publish-release -- "What changed in this version"
   ```

   `scripts/release.mjs` creates a **draft** release `v<version>` first, then builds and uploads the installer, its `.blockmap` and `latest.yml` into it. It checks that all three files are there before publishing the draft as the latest release. Creating the draft up front matters: electron-builder uploads files in parallel, and on an empty draft each upload can create its own release.
3. Running copies notice within 6 hours (or at their next start, or with **Settings → Check now**). They download in the background and show **Update ready · Restart** in the status bar.

`MC_SMOKE_UPDATE=1` on a packaged build checks the releases repo and downloads (but doesn't install) any newer version, logging each step.

### Automation test

`MC_SMOKE_AUTOMATION=<git repo with a commit>` checks the schedule math and template variables, fires an overdue recurring template, and runs two real queued Haiku tasks with one slot (about $0.05), which must run one after the other. It restores your queue settings and deletes everything it created.

### Unit tests and CI

`npm test` runs the Vitest unit tests for pure logic: schedule math, dependency rules, the stream parser, pricing and the diff parser. They're free and take under a second. GitHub Actions (`.github/workflows/ci.yml`) runs type-check, unit tests and build on Windows for every push. Keep new logic testable by putting it in Electron-free modules (`src/shared/`, or main-process files that don't import `electron`).

### Chain test

`MC_SMOKE_CHAIN=<empty scratch folder>` runs the v0.7 flow end to end in that folder (about $0.10 of Haiku):
1. Turn on git, with a `.env` and `node_modules` that must stay out.
2. A 3-step chain whose first check fails, so the next step must stay blocked.
3. Fix the check and re-run it, so the chain continues by itself on chained branches.
4. A follow-up, then merging the last branch.
5. The monthly budget guard holding a queued task.

Everything it creates is removed, and your settings are restored.

`MC_SMOKE_NAMES=<project folder name, e.g. WBP>` logs every project's name, icon and chat count, lists that project's chats (with worktree labels), renames one chat and puts it back, and screenshots the chats and the Name and icon dialog. Free.

`MC_SMOKE_SPEND=<empty scratch folder>` checks v0.9 against your real data, for free:
1. It reads the size of the busiest project's latest chats and builds its startup report.
2. It lists chats over $1 today.
3. It limits the scratch folder to one MCP server with Haiku as its default model, then starts Claude there and reads its init event. Only that server and Haiku must appear. The process is stopped before any request goes out.
4. It screenshots the Spending card, and the size meter on a resumed test chat.

Settings are restored afterwards.

`MC_SMOKE_SHOTS=<project folder name, e.g. bot>` screenshots every screen: Home, that project's tabs, Tasks, Agents, Usage, Search, the palette, Settings and the shortcuts list. It then presses real shortcuts and checks each one: `Ctrl+1/2/3/5`, `Ctrl+Shift+F`, `Ctrl+/` and `Ctrl+B`. Last, it switches to the light theme with `Ctrl+Shift+L`, screenshots it, and puts your theme back. Free. Use it for before/after comparisons of UI changes.

`MC_SMOKE_HUB=<empty scratch folder>` checks the v0.11 pieces, for free:
- Notes: save, pin and delete.
- Knowledge: the doc list, and a search.
- New project: creates one with CLAUDE.md and git.
- Quick chat: the folder must be hidden as scratch.
- Due dates: a reminder must fire exactly once.
- Claude Code status and the greeting name.

It removes what it created.

`MC_SMOKE_SKILLS=1` checks the Skills page and Eco mode against your real skills and chats, for free:
- Lists the skills by source and the skill uses from the index.
- Turns Eco mode on for the tour (restored afterwards) and logs the launch flags.
- Asks the coach about your largest recent chat through the hook server (a real `UserPromptSubmit` round trip), then again directly, which must return nothing new.
- Screenshots the Skills page, eco:coach's detail and Settings → Spending.

`MC_SMOKE_VAULT=<empty scratch folder>` writes a sample vault there (INDEX, linked notes, a decision, a briefing), shows it as a project for the tour, and checks link resolution, backlinks, the live watcher (a new file appears), the graph, and the empty "Build vault" screen and its dialog (cancelled). It screenshots each as `<MC_SMOKE>-vault-*.png`. Free: nothing is sent to Claude.

Self-tests run in their own profile, `%APPDATA%\Mission Control (self-test)`, starting from a copy of your settings, so they work while the installed app is open and never change its data.

`MC_SMOKE_QUIT=<n>` runs only the quit test: n terminals printing as fast as they can, then the window closes. It logs the time of each quit stage (it should reach `process exit` in well under a second). The old in-process terminals hung here on the first try (ADR 0018).

`MC_SMOKE_PERF=1` runs only the speed test, for free. It logs startup times in ms since the process started (main loaded, ready, window created, page loaded, first project shown), how long the project list and git info take, then idle CPU and memory per process with no agents and with 4 shell agents, plus any endless animation still running. `MC_SMOKE_PERF=startup` stops after the startup part. `MC_SMOKE_PERF=fresh` first deletes the test's own index, to time a full build. Single runs are noisy: compare several runs, alternating old and new builds (ADR 0019).

`MC_SMOKE_WS=<empty scratch folder>` checks workspaces and Send to… (about $0.001 of Haiku):
- Opens two PowerShell agents and one real Claude agent (Haiku) and saves them as a workspace through the dialog.
- Sends "pong" with Send to… and checks the reply in the chat file.
- Closes everything, then reopens the workspace (the chat must be resumed, in the grid) and deletes it.

`MC_SMOKE_AGENTS=<project folder name, e.g. bot>` checks v0.17 for free:
- Logs the project's chat names (and where each comes from) and the recap of its newest chat, and screenshots the Chats tab with the recap card.
- Opens four agents "resumed" from the newest chats. They're PowerShell tabs, so nothing runs in Claude and no chat file is touched.
- Shows them in the grid and checks the "Last time" banners. Drags a divider with the real mouse, then minimizes one agent and maximizes another.
- Screenshots each step as `<MC_SMOKE>-agents-*.png` and clears the grid sizes it saved.

Add `MC_SMOKE_AGENTS_AI=1` to also run Summarize and Name chats for real (Haiku, about $0.005). It logs the old and new names, then puts the store back as it was.

`MC_SMOKE_INBOX=1` checks plan cost and the inbox, for free. It writes three days of sample plan readings into the self-test's own index, made from your real chat costs at a known rate (1% of the week per $2.50), and checks the calibration finds that rate again. It adds a finished, a failed and an overdue task, then checks the inbox items, the sidebar badge, dismissing, both digests and the plan shares on Usage and Tasks. It screenshots the Inbox, Usage, Tasks and Settings → General as `<MC_SMOKE>-inbox-*.png`. The tasks and sample readings are removed afterwards.

`MC_SMOKE_PLAN=1` asks your Claude account for your plan limits (one small request, no model use), logs the windows and plan, checks the top-bar meter text and screenshots Home and Usage. Free. (Normal smoke runs don't poll.)

`MC_SMOKE_BRIEF=<empty scratch folder>` lists the session briefings (compaction summaries) in your chats. It writes the newest one as a file into the scratch folder (never into your projects), checks the wrapper lines are gone and that "latest briefing" finds it, and screenshots Knowledge → Session briefings. Free.

### Agent team verification

Agent-team changes are covered by `node node_modules/vitest/vitest.mjs run src/shared/teamPlan.test.ts src/main/taskTeams.test.ts`. After the normal typecheck/build, `MC_SMOKE_TEAM=1` with `MC_SMOKE=<absolute path ending in .png>`, `MC_SMOKE_PROFILE=<new isolated profile>`, and `MC_SMOKE_CLEAN=1` runs the real UI/IPC/child-process/git flow with a local fake Claude CLI. It needs Node and Git on PATH, makes no model calls, and captures the composer, plan, running team and final result in both themes. Use a new profile for each run because the fixture initializes its own test repository. On Windows, launch Electron with `Start-Process -WindowStyle Hidden -Wait` and redirect stdout/stderr to files so the GUI process retains valid output handles.

### Free guided onboarding tour (Windows)

Prerequisites: installed development dependencies and Electron, a desktop session, Node on PATH and Git for Windows on PATH. No Claude/Codex CLI, login, subscription or API key is required. Build first. Resolve Electron through Node so this also works when dependencies are inherited from a parent checkout.

```powershell
npm run typecheck
npm test
npm run build
$electronPath = node -p "require('electron')"
$env:MC_SMOKE_PROFILE = Join-Path $env:TEMP ('mc-onboarding-' + [guid]::NewGuid().ToString('N'))
$env:MC_SMOKE_CLEAN = '1'
$env:MC_SMOKE_ONBOARDING = '1'
$env:MC_SMOKE = Join-Path $env:MC_SMOKE_PROFILE 'onboarding.png'
$env:MC_SMOKE_LOG = Join-Path $env:MC_SMOKE_PROFILE 'smoke.log'
$onboardingProcess = Start-Process -FilePath $electronPath -ArgumentList '.' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:MC_SMOKE_PROFILE 'stdout.log') -RedirectStandardError (Join-Path $env:MC_SMOKE_PROFILE 'stderr.log')
$onboardingProcess.WaitForExit()
Get-Content $env:MC_SMOKE_LOG
# Only after the first tour creates onboarding-checkpoint.json:
Remove-Item Env:MC_SMOKE_CLEAN
$env:MC_SMOKE_ONBOARDING = 'restart'
$onboardingProcess = Start-Process -FilePath $electronPath -ArgumentList '.' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:MC_SMOKE_PROFILE 'restart-stdout.log') -RedirectStandardError (Join-Path $env:MC_SMOKE_PROFILE 'restart-stderr.log')
$onboardingProcess.WaitForExit()
Get-Content $env:MC_SMOKE_LOG
```

Read the log, not just the process exit code: the existing smoke dispatcher sets process.exitCode but Electron's app.quit may still return zero on Windows. Any `[smoke] FAILED` means failure. The first pass must contain the onboarding fixture-tour success line; the second must report actual-process restart preservation. Screenshots, `onboarding-report.json`, the persistence checkpoint and `provider-invocations.jsonl` remain under this TEMP profile for inspection. The disposable Git repository is adjacent to TEMP at `%LOCALAPPDATA%/mc-onboarding-<GUID>-repositories/project` because the composer intentionally excludes TEMP scratch folders; the report records its exact path. Do not treat missing reports or missing assertions as a pass.

The bootstrap refuses non-Windows hosts, profiles outside TEMP/mc-onboarding-*, reused store files for an initial run, unavailable Node/Git, real provider executables in required system/Git PATH directories, or wrappers that fail their self-test. It establishes Claude/Codex fixtures before app ready and renderer effects. Child PATH is restricted to fixture/system/Git directories; inherited provider API credentials are removed in this process. Fake CLIs implement version, auth, task streams, deliberate failure and interruption using actual child processes. Unexpected prompts fail closed. A provider sentinel records each local invocation without prompts or tokens. Package-manager wrappers fail if invoked. Diagnostic version/auth output contains a private canary which must not appear in rendered diagnostic text, returned readiness snapshots or the smoke log. No personal Claude/Codex configuration is written. A process-local empty Git global config disables inherited credential helpers, signing and hooks.

Clean smoke settings disable queue execution, automatic briefings, updates and hotkeys; existing MC_SMOKE startup disables recurring runs and plan polling. The tour also blocks renderer HTTP(S) requests. All model execution resolves locally. The app may still read existing local chat history through its normal indexer; the smoke profile is not a separate Windows account. Do not use screenshots from a machine with private chat titles as public documentation without inspecting them.

The tour selects Claude-only, Codex-only and both through real checkboxes; checks missing CLI and Git, signed-out, unsupported auth output, offline, cancellation and recovery; exercises skipped/dismissed/resumed setup; verifies non-Git, valid Git, malformed/unsupported manifests; reviews/edits/saves suggestions and preserves existing metadata; creates an explicit permission/worktree task and observes streamed progress, final output and a real diff; runs Codex failure, interruption and retry. Resolved connection problems are rechecked through Inbox. Dark/light screenshots use the actual 960x600 outer window and assert horizontal overflow bounds. Restart is a separate process and checks saved provider selection, setup status, user setting and project preservation. Captured application `.log` files are also checked for the private diagnostic canary. A failed run retains a failure screenshot and `onboarding-failure.json` with its last verified assertion, rather than implying later steps passed.

Command inference supports root `package.json` only, using `dev`, `start` and `test` scripts where present, with npm/pnpm/yarn/bun selection from metadata/lockfiles. Conflicting lockfiles are ambiguous. `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle` and `Makefile` are recognized but inference is unsupported. Diagnostics do not install dependencies, create Git history or run scripts. Suggested commands remain untrusted and require explicit review/edit/save; saving does not change automatic check commands. `SHOULD_NOT_RUN.cjs`, the absence of node_modules/.git in negative fixtures, and package-manager sentinel records prove the no-execution checks.

To complete first-task guidance, create the starter task, follow its activity until its final result is displayed, open **Changes**, inspect the diff and select **Reviewed this diff and results**. Resume setup to see the completed guide. The tour waits for the displayed result rather than merely backend completion, then acknowledges the actual current diff through the review UI. Completion leaves the task in Review and does not merge. New or failed review snapshots invalidate diff evidence; a new run needs fresh result and diff inspection. Inspection observations are session-local, so after restarting, reopen the result and review surface. The tracked task identity and setup preferences persist.

Integration verification on 2026-10-28: typecheck, all 273 tests in 28 files, and production build passed (existing chunk-size warning). The complete onboarding tour now includes first-task guide completion, missing-Git recovery, keyboard trap/focus return, task-problem retry and verified removal. `mc-onboarding-78fd378e213f4976801722ac02f4864d` passed the complete tour and its separate restart process. A final run and surrounding regression profiles are recorded below. Tests also cover merging result/diff observations in either order, resetting observations for other runs, changed/unavailable fingerprints, and resolving verified checks when another requirement remains unavailable. No standalone fixture-helper unit tests were added: this module's helpers orchestrate Electron/filesystem/process behavior and are exercised through the real tour.

Final integration evidence: `mc-onboarding-aab8ed867d2e44f1b224c2f8872d4c35` contains the complete passing report with no defects, minimum-size dark/light screenshots, and `restart.log` confirming second-process preservation. Free surrounding tours passed in `mc-free-cf23f53e33c54250ae8ca72cf98b0b5c` (TEAM), `mc-free-e92a065dbd1847edbb9d808c8857b630` (RUN, including stale-review/check rejection and a fresh checked merge), and `mc-free-f565eabac1b648b481562a4cb2974b14` (Codex tasks/search fixtures). Profiles are under this machine's TEMP directory and are disposable verification artifacts, not repository fixtures. The paid-provider path was intentionally not exercised; authentication readiness is based on supported CLI status output rather than a model call.

### Additional free regression tours

Use a fresh profile for each invocation and clear the onboarding flag before switching dispatch modes. These use existing fixtures; do not substitute `MC_SMOKE_TASKS`, `MC_SMOKE_CODEX_TASKS=1` or `=review`, which call real providers.

```powershell
Remove-Item Env:MC_SMOKE_ONBOARDING -ErrorAction SilentlyContinue
$env:MC_SMOKE_CLEAN = '1'
foreach ($tour in @('TEAM', 'RUN', 'CODEX_TASKS')) {
    $env:MC_SMOKE_PROFILE = Join-Path $env:TEMP ('mc-free-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $env:MC_SMOKE_PROFILE | Out-Null
    $env:MC_SMOKE = Join-Path $env:MC_SMOKE_PROFILE 'smoke.png'
    $env:MC_SMOKE_LOG = Join-Path $env:MC_SMOKE_PROFILE 'smoke.log'
    [Environment]::SetEnvironmentVariable('MC_SMOKE_' + $tour, $(if ($tour -eq 'CODEX_TASKS') {'fixtures'} else {'1'}), 'Process')
    $fixtureProcess = Start-Process -FilePath $electronPath -ArgumentList '.' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:MC_SMOKE_PROFILE 'stdout.log') -RedirectStandardError (Join-Path $env:MC_SMOKE_PROFILE 'stderr.log')
    $fixtureProcess.WaitForExit()
    Get-Content $env:MC_SMOKE_LOG
    [Environment]::SetEnvironmentVariable('MC_SMOKE_' + $tour, $null, 'Process')
}
Get-ChildItem Env:MC_SMOKE* | Remove-Item
```

TEAM exercises a real local planner/worker CLI, shared worktree, integration, checks and commit; RUN exercises real PowerShell streaming/failure/stop and guarded Git review/merge; CODEX_TASKS=fixtures covers templates/dependencies/cap rejection and search indexing, with synthetic task results only in that legacy tour. The new onboarding tour does not use synthetic task results.

Troubleshooting: a missing fixture prerequisites error is intentional; install development Node/Git and rebuild, never remove the guard or allow fallback to a real CLI. A timeout should be investigated using the last verified assertion and isolated log; keep the failed profile and rerun with a new GUID. Unsupported auth output is unknown, not signed-out or ready. Recheck after changing the fixture state, tool installation or project contents. Do not delete or move personal CLI directories to simulate missing tools. Cleanup is optional: retain evidence, then remove only the specific TEMP profile/repositories you created after verifying their resolved paths. No automatic broad cleanup runs.
