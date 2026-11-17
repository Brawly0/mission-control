# 0045: Idle and startup trim

Date: 2026-11-16

## Context

The speed test (`MC_SMOKE_PERF=1`) showed 4.5% CPU (3.4% GPU) with the app idle on Home. The cause was the endless float animation on empty-state art. The first project appeared ~1.1s after the page loaded, git lookups for all projects took ~2s, and the archived Tasks board (ADR 0042) was still mounted and re-rendered on every app update while hidden.

## Decision

- No endless animation on empty-state art.
- The index worker starts its first run 2.5s after it starts, and its change scan yields every 200 files. That way, startup queries (which folders chats worked in, for the project list) don't wait behind a synchronous scan. A `running` flag stops two runs from overlapping.
- `listProjects` shares a listing that started within the last 250ms, so the UI and services asking at the same time at startup do the disk work once.
- `gitInfo` caches `git rev-parse` per folder until git changes something (`forgetGitInfo`), so a refresh starts one git process per project instead of two.
- Renderer polls (git badges, Codex usage, Changes) skip while the window is hidden and only update state when the answer changed, so an idle app doesn't re-render every 5–60s.
- TasksView, TaskComposer and TaskDrawer are lazy chunks. TasksView and TaskDrawer mount only when `TASKS_UI` is on.
- `smoke.ts` loads only for `MC_SMOKE` runs.
- Every successful `listProjects` saves the list to `projects-cache.json` in the app's data folder. It's a separate file from `store.json`, so a refresh doesn't rewrite the store or its backup, and it's written only when the list changed. On start the UI shows that list right away (`cachedProjects`), and the real listing replaces it when it arrives. A cached list never overwrites a real one.

## Result

Idle on Home: 0.2% CPU, 0% GPU (was 4.5% / 3.4%). Renderer heap at start: 13 MB (was 22). Main-process bundle: 352 KB (was 480). Renderer entry chunk: 461 KB (was 543). `gitInfoMany` for all projects: 0.7–1.3s (was ~2s). First project on screen: ~0.9s after the process starts (was ~2.05s).
