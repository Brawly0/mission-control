# 0019: Speed and resource use (measured first)

**Status:** accepted · 2026-10-26

## Context

v0.19 step 2 asked whether the app was slow anywhere. The new speed self-test (`MC_SMOKE_PERF`, see DEVELOPMENT.md) measures:
- startup marks from process start (main loaded, ready, window created, page loaded, first project shown);
- how long the project list and git info take;
- idle CPU and memory per process, with no agents and with 4;
- a full index build from an empty index (`MC_SMOKE_PERF=fresh`).

To compare before and after, the previous commit was built in a scratch worktree and both builds were run alternately on the same machine.

### Findings
- **Startup was already fine when warm, about 1.0 s to the first project.** The main process loads in about 120 ms; a bare Electron app is ready in about 150 ms.
  - Earlier readings of 2–5 s were the first launch after a build (cold disk, virus scan) or a busy machine. Single runs are noisy: compare several, alternating.
- **The renderer bundle was 2.2 MB because electron-vite doesn't minify the renderer by default.**
- **Each project's git info started three `git` processes.** At startup the app and the index finishing its first run both asked for the list at once, so it all ran twice.
- **With 4 idle shell agents open, the app used 2.4–3.7% CPU and about 2% GPU, even on Home.** Every project with an open agent showed a pulsing "working" dot in the sidebar. An endless CSS animation repaints every frame.
- **A full index build of 532 MB of chats (100 chats, 8.5K messages) takes about 4.2 s** in the worker. The normal start-up run takes 3–250 ms. No change needed.

## Decisions

- **Minify the renderer** (`build.minify` in `electron.vite.config.ts`).
- **Load rarely used code on first use** with `React.lazy`:
  - the terminal (xterm, 334 KB), when the first agent's pane mounts;
  - the Markdown renderer (155 KB), behind `Md` and `NoteMarkdown`. Until it loads, the text shows plain, for a moment, the first time only;
  - Usage, Search, Notebook, Skills and Knowledge: mounted the first time they're shown (`OnceShown`), then kept mounted like the other pages so they keep their state;
  - the Settings and Templates dialogs, and the docs vault tab.

  Startup JS went from 2.2 MB to 437 KB. Terminal output that arrives before the pane loads was already buffered by `terminalBus`; an exit that arrives first is now buffered too.
- **Git info:**
  - One `rev-parse` call gets both the top level and the common dir, so it's two processes per project, not three.
  - Lookups already running are shared between callers.
  - Anything that changes git (`forgetGitInfo`) drops the cache and the running lookups, and a lookup that started earlier doesn't write its result back.
- **The renderer coalesces project refreshes:** a refresh asked for during one waits for it and runs once more after it.
- **Only a working agent pulses in the sidebar.** An open idle agent shows a still dot, and the pill's tooltip says "N open, M working".

## Results (same machine, alternating runs)

| | Before | After |
|---|---|---|
| Startup JS | 2.2 MB | 437 KB |
| First project shown (warm) | 1.00–1.06 s | 0.95–1.02 s |
| Renderer JS heap at start | 15 MB | 11 MB |
| Idle, 4 agents, Home | 2.5% CPU, 1.7% GPU, 698 MB | 0.8% CPU, 0% GPU, 668 MB |
| Idle, 4 agents, Agents view | 3.5% CPU, 670 MB | 2.3% CPU, 650 MB |
| Idle, no agents | 0.5% CPU, 461 MB | 0.4–0.7% CPU, 457 MB |

The remaining idle cost on the Agents view is the focused terminal's blinking cursor, which is normal terminal behaviour.
