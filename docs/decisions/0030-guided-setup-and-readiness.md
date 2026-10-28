# 0030: Guided setup and observational project readiness

Date: 2026-10-28

Status: Accepted.

## Context

A new user needs an in-app path from selecting Claude/Codex to opening a folder, running a useful task and reviewing its actual result. Existing users must keep their settings, projects, commands and review safeguards. Tool availability, authentication and project requirements can be missing, offline, ambiguous or change during a request.

## Decision

Reuse connection cards, project creation, the task composer/runner/drawer, RunPanel, ChangesPanel, Settings and Inbox. Share diagnostic snapshots and setup preferences through one renderer readiness provider and the typed preload/IPC API. Keep first-task guidance derived from the explicitly selected task's real lifecycle and run-scoped inspection evidence rather than advancing on clicks or elapsed time. Never infer diff inspection from opening a task drawer or reading its final message.

Diagnostics are observational and sanitized. An individual ready result means its fixed probe verified that requirement at that time. Missing is confirmed absence; unavailable means uncertainty; malformed manifests fail. Cancelled or superseded results cannot clear problems. Do not display raw auth output, account data, tokens, manifest contents or arbitrary subprocess stderr. Numeric CLI versions and fixed explanations are sufficient. Successful installation/authentication checks do not prove a model call, dependency installation, or test will work.

Each renderer owns connection and project request slots. Replacing a request aborts the previous slot. Cancellation, bounded queues/concurrency, subprocess deadlines/output caps, bounded file reads and shutdown cancellation limit resource use. The renderer checks request identities before applying results. Problems disappear only after fresh verification of the same check; switching providers/projects or a check becoming unavailable cannot manufacture resolution.

Setup state is additive in the existing app store: selected providers, status, last step and timestamp. Skip, dismiss and resume change only this state. Migrate defaults without replacing existing projects/settings. Existing command saving, task queue behavior, teams, notifications and merge safeguards retain their semantics.

Infer only supported root package.json run/test scripts. Preserve package-manager/script provenance and mark suggestions untrusted. Recognized unsupported manifests get actionable manual-command guidance. Reading or saving a suggestion grants no permission to install packages, initialize Git, execute scripts or enable automatic task checks. The user reviews and edits suggestions, explicitly saves them, and separately chooses execution. Task permissions and worktree isolation remain visible choices; a worktree separates changes but is not a security sandbox.

## Verification and consequences

Unit tests cover probe uncertainty, cancellation, stale completion, manifest errors, persistence compatibility and problem reconciliation. The Electron onboarding smoke uses a fresh TEMP profile, local Git repositories and fake Claude/Codex children; production readiness and progress are never replaced with synthetic success. A restricted PATH and provider invocation sentinel prevent fallback to installed providers. Package-manager wrappers fail on invocation; fixture scripts leave a forbidden-command marker if accidentally run. Version/auth fixtures include a private canary to check UI/diagnostic sanitization. Screenshots and assertions cover themes and the actual 960x600 minimum. Restart verification requires a second process using the same fixture profile.

Coverage and failures must be reported separately from successful assertions. ChangesPanel supplies current fingerprint evidence and explicit review acknowledgement through TaskDrawer; App merges it with displayed-result evidence for the exact completed run. New or unavailable snapshots clear diff acknowledgement. Late loads from superseded requests, other paths or closed review surfaces cannot overwrite current evidence. Viewing a tab alone cannot complete the guide. Completion does not mark done, run checks or merge. No personal provider configuration, versions, releases or branches are changed by this work.

The fixture tour retains partial verified assertions and a failure screenshot on integration failures. Missing Git is checked by temporarily restricting only the process PATH, then restoring it and verifying recovery; no installed executable or personal configuration is renamed. The 2026-10-28 connected tour verifies guide completion only after the final result is displayed and the current real diff is acknowledged. A separate restart phase verifies persistence; free team/run/review/Codex fixture tours cover surrounding behavior. Unit regressions cover inspection ordering, run changes, stale or unavailable diff evidence, and independently resolving verified requirements in partially unavailable diagnostics.
