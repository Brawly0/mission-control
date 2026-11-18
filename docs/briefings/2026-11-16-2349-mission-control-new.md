# Session briefing: performance trim (2026-11-16)

## Goal
Make Mission Control lighter and smoother: remove dead code and unused features, cut idle CPU, and speed up startup.

## Done and verified
Typecheck, all 395 unit tests and `npm run build` pass. Numbers come from the speed test (`MC_SMOKE_PERF`), baseline vs after:

| | Before | After |
|---|---|---|
| Idle CPU on Home | 4.5% (GPU 3.4%) | 0.2% (GPU 0%) |
| Renderer JS heap at start | 22 MB | 11–14 MB |
| First project on screen | 2.05s | ~0.9s (warm cache) |
| `gitInfoMany`, all projects | ~2.0s | 0.7–1.3s |
| Main-process bundle | 480 KB | 352 KB |
| Renderer entry chunk | 543 KB | 461 KB |

What changed:
- **Idle CPU:** removed the endless `empty-art-float` animation (`art.css`). It was the whole idle GPU cost.
- **Tasks UI (archived, ADR 0042):** TasksView, TaskComposer and TaskDrawer are now lazy chunks. TasksView and TaskDrawer mount only when `TASKS_UI` is on. Before, TasksView was mounted hidden and re-rendered on every app update.
- **Polling:** git badges (15s), Codex usage (60s) and the Changes panel (5s) skip while `document.hidden`, and set state only when the answer changed (`sameGit`, JSON comparison).
- **Git:** `git rev-parse` is cached per folder until `forgetGitInfo()`, so each refresh starts one process per project instead of two.
- **Index worker:** the first run starts 2.5s after the worker starts. The change scan yields every 200 files, and a `running` flag stops two runs from overlapping. The startup project query used to wait ~900ms behind the synchronous scan.
- **listProjects:** concurrent callers share a listing that started in the last 250ms. Every successful listing saves `projects-cache.json` in userData, and the UI shows that cached list at once via the new IPC `cachedProjects`.
- **Main:** `smoke.ts` loads only when `MC_SMOKE` is set (dynamic import in `index.ts`). `perfMark` and `smokeLog` are thin wrappers around it.
- **Dead code:** removed `ECO_SKILL_NAME`, `useProjectName` and `READINESS_MANIFESTS`. An import-graph scan found no unused files.
- **Disk:** deleted old test folders in `out/` and old installers in `release/`, 8.6 GB in all. Kept `out/{main,preload,renderer}` and the 0.37.0 installer, `.blockmap`, `latest.yml` and `SHA256SUMS.txt`.
- **ADR:** `docs/decisions/0045-idle-and-startup-trim.md`.

## Not verified
- No full UI smoke run (`MC_SMOKE_SHOTS` etc.) after these changes, only the speed test.
- Not tested by hand: the Changes panel after commit/merge, the guided-setup "create task" path (TaskComposer is now lazy), and a rename right at startup (the cached name shows for ~1s).

## Decisions and why
- **Tasks code kept, only unloaded.** The scheduler and vault builds use the same engine, and several self-tests drive the Tasks UI. Deleting ~3,000 lines wasn't worth the risk.
- **Project cache in its own file, not `store.json`.** It changes often; `saveStore` copies a `.bak` on every write. The cache is written only when the list changed.
- **250ms share window for listProjects.** It dedupes the startup burst without serving stale data after a rename or move.
- **Unused `export` keywords left in place** (~80 symbols only used inside their own file). No bundle gain, and editing them would mean churn across many files.

## Open problems
- **Another session was editing the repo at the same time:** AI-terminal removal (staged) and the version bump to 0.38.0, plus unstaged `cli/` edits. My edits also touch files it staged: `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`. Nothing is committed.
- **First launch** without a cache still takes ~2s (cold reads of each project's newest chat and README).
- **`loadStore()` re-reads and parses `store.json` on every call** (listProjects, IPC handlers). This is a possible next win: keep an in-memory copy and invalidate it on save.

## Exact next steps
1. Check `git status` and coordinate with the other session's staged changes before committing.
2. Run `MC_SMOKE_SHOTS=<project>` and `MC_SMOKE_RUN=1` (see `docs/DEVELOPMENT.md`) to check the UI and the Changes/Run tabs.
3. Commit on a branch: `perf: idle and startup trim (ADR 0045)`.
4. Optional: cache `loadStore()` in memory.
5. Tick the roadmap item if one exists. `docs/ROADMAP.md` was staged by the other session, so merge with care.

## Gotchas
- `git checkout -- <file>` restores the **staged** version. With another session staging work, it can silently drop or keep changes you didn't expect.
- **Speed test:** use the scratch runner below, or launch `node_modules\electron\dist\electron.exe .` with `MC_SMOKE`, `MC_SMOKE_PERF=startup|1` and `MC_SMOKE_LOG` through `Start-Process -WindowStyle Hidden -Wait`. Results are noisy while another build runs: compare several runs.
- The self-test profile is `%APPDATA%\Mission Control (self-test)`, and it has its own `projects-cache.json`.
- Downloading packages via `npx -y` (e.g. knip) was blocked by the permission classifier.
- No Python on this PC: use node for scripts.

## Files that matter
- `src/main/claudeData.ts`: `listProjects` (sharing + cache save) and `readProjects`
- `src/main/store.ts`: `loadProjectCache` / `saveProjectCache`
- `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`: `cachedProjects` IPC
- `src/main/git.ts`: `rootCache`, `revParse`
- `src/main/indexWorker.ts`: `run` / `runOnce`, yielding scan, delayed first run
- `src/main/index.ts`: lazy smoke module
- `src/renderer/src/App.tsx`: lazy Tasks components, `sameGit`, hidden-window polls, cached project list
- `src/renderer/src/components/ChangesPanel.tsx`: unchanged-snapshot skip
- `src/renderer/src/art.css`: animation removed
- `docs/decisions/0045-idle-and-startup-trim.md`
- Scratch perf runner (may be cleared): `C:\Users\bsbra\AppData\Local\Temp\claude\612afe87e16ebacc\298785f3-9744-4e58-aad6-fb92852ccbae\scratchpad\perf.ps1`
