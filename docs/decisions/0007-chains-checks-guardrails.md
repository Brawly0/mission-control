# 0007: Chains build on branches, checks gate them, guardrails hold automation

**Status:** accepted · 2026-10-20

## Decisions

- **A failed step blocks the chain** (user's choice). Dependents wait, and the card says why. Retry the failed task (or fix and re-run its checks) to continue, or press **Run anyway**. Skipping or running regardless was rejected: it hides failures in unattended pipelines.
- **Steps build on each other's branches.** A worktree step branches from the previous successful step's branch but merges into the original base, so one merge lands the whole chain. To make that possible, headless worktree tasks commit their changes when they succeed. That's safe on a throwaway branch, and it's what Merge needs anyway.
- **Checks are a shell command per project** (PowerShell, exit code 0 = pass) rather than a test-runner integration. It works for any stack (`npm test`, `pytest -q`, `cargo test`, a script), and the output is shown as-is.
- **Guardrails never stop you, only automation.** Over budget or at high plan usage, the queue, recurring tasks and chain auto-starts hold. Tasks you start by hand still run. Monthly spend comes from the chat index, so it counts everything, not just Mission Control's runs.
- **Turn on git previews first** and keeps secrets and dependencies out by default. It sets a repo-local commit identity only when git has none, using the GitHub CLI account's noreply address. The global git config is never changed.
