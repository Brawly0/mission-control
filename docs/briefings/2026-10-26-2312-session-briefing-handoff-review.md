# Session briefing: v0.19 finished and committed, not released (2026-10-26 23:12)

## Goal
Finish v0.19 "make it solid", in the agreed order: 1 walkthrough fixes → 3 code cleanup → 2 speed → 4 simpler UI → 5 backlog. Then release 0.19.0 when the user says so.

## Where things stand
- **All five v0.19 steps are done and committed on `main`.** There are 6 commits since v0.18.0, none pushed:

  | Commit | What |
  |---|---|
  | `e812f99` | fix: step 1 polish |
  | `86cf02c` | refactor: split App.tsx (no behaviour change) |
  | `5a29e51` | refactor: split main/index.ts (no behaviour change) |
  | `f4763e4` | docs: roadmap, file map, IPC handlers |
  | `c871ef7` | perf: speed (ADR 0019) |
  | `a647b84` | feat: simpler UI |

- `package.json` still says **0.18.0**. v0.18.0 is the installed and released version.
- **Release is waiting on the user.** The last message asked "Should I push and release v0.19.0?" and the user hasn't answered.
- One untracked file: `docs/briefings/2026-10-26-0952-session-briefing-handoff-review.md`, plus this briefing.

## Done and verified
- `npm run typecheck`, `npm run build` and the 137 unit tests all pass after every step.
- Self-tests passed: SHOTS (all shortcuts, including Ctrl+5 opening the More group), CHAT (tables), AGENTS, VAULT, INBOX (badge 3, dismiss), SKILLS, BRIEF, and a clean close with 2 agents printing. Screenshots were checked by eye.
- Speed (same machine, alternating old and new builds; details in ADR 0019):

  | | Before | After |
  |---|---|---|
  | Startup JS | 2.2 MB | 437 KB |
  | First project shown (warm) | ~1.0 s | ~0.95 s |
  | Renderer heap | 15 MB | 11 MB |
  | Idle, 4 agents, Home | 2.5% CPU, 1.7% GPU | 0.8% CPU, 0% GPU |
  | Idle, 4 agents, Agents view | 3.5% CPU | 2.3% CPU (cursor blink) |

- Simpler UI, all four options the user chose:
  - **Sidebar:** 6 main pages; the rest sit under **More**, which opens by itself while one of them is shown.
  - **Top bar:** the gear and theme buttons are gone. The avatar opens Settings; Ctrl+Shift+L still toggles the theme.
  - **Home:** the clock card is gone; the date is in the greeting line. It says "N agents open · N working · N need you".
  - **Status bar:** shows only working agents, agents that need you, updates, indexing, the git branch, and "Notifications off".
- `docs/ROADMAP.md`: v0.19 is ticked ✅. README updated.

## Not verified
- No real-use check of the new UI by the user yet.
- The release flow has not been run for 0.19.0.

## Decisions and why
- **Measure before optimizing.** The new `MC_SMOKE_PERF` self-test showed startup was already fine. So the work went to bundle size, idle CPU and duplicate git calls, not startup.
- **Minify the renderer.** electron-vite doesn't do it by default.
- **Load code on first use** with React.lazy: xterm, the Markdown renderer, five pages (via `OnceShown`, which keeps them mounted afterwards), two dialogs and the vault.
- **Git info:**
  - one `rev-parse` call instead of two;
  - lookups already running are shared;
  - `forgetGitInfo()` uses a generation counter, so stale lookups never write to the cache.
- **Only working agents pulse.** An endless CSS animation per idle agent cost CPU and GPU, and "working" was misleading. The UI now says "open" for live agents and "working" only when `hookStatus === 'working'`.
- **The cursor-blink CPU on the Agents view stays.** It's normal terminal behaviour.

## Exact next steps
1. **If the user approves the release:**
   1. Bump `package.json` to `0.19.0` with node, not PowerShell (`Set-Content` adds a BOM).
   2. `npm run typecheck && npm run build`.
   3. Commit `chore: release 0.19.0`, and the untracked briefings if wanted.
   4. `git push`.
   5. `node scripts/release.mjs "<notes>"`. The notes come from the "Where things stand" and "Done" sections above.
   6. `git tag v0.19.0 && git push origin v0.19.0`.
2. **Pending offer, not answered:** add **v0.20** to the roadmap with prompt snippets and a per-project `BRIEFING.md`. Other ideas raised: an agent-activity summary, review before merge, MCP health per project, parallel chain branches, code signing.

## Open problems (user-side, the app must not touch them)
- 27 `AppData-Local-Temp-…` scratch chat folders in `~/.claude/projects`. Never write to `~/.claude/`.
- The GitHub MCP has a malformed auth header. The magic, filesystem and ai-game-developer MCP servers fail to connect.
- Real-use tests still owed: an Eco chat, Build vault, and the morning digest.
- No code signing.

## Gotchas
- **Never push or release without an explicit OK.** Commit only when asked. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Don't kill the user's processes** (`kids.py`, old Claude chats). Stopping my own test electron processes is fine.
- **OAuth token:** `~/.claude/.credentials.json` is read only and sent only to api.anthropic.com. Never log it, store it or refresh it. No email address in the UI.
- **Self-tests:**
  - Run with `MC_SMOKE*` env vars and poll the log for `closing window|FAILED|UNCAUGHT`.
  - Check free memory first.
  - A test that drives a lazily loaded page must wait for it (`openView` in `smoke.ts`).
- **Perf runs:**
  - `MC_SMOKE_PERF=1` is the full run; `=startup` stops after startup; `=fresh` rebuilds `index-perf.db`.
  - Don't run hidden: a hidden window doesn't paint, so GPU reads 0.
  - Single runs are noisy, so alternate builds.
  - Building an old version in a worktree with junctioned `node_modules`: remove the junction with `cmd //c rmdir` **before** `git worktree remove --force`.
- **Shell editing:** Git Bash heredocs and `node -e` break on backticks and `$`, and JS `String.replace` mangles `$'`. Use the Edit/Write tools or a `.cjs` script.
- **Bundle analysis:** `scratchpad/vsm.config.mjs`, `attr.cjs` and `prof.cjs` live in the old session's scratchpad, not the repo.

## Files that matter
- Docs:
  - `docs/ROADMAP.md`
  - `docs/decisions/0019-speed-and-resources.md`
  - `docs/DEVELOPMENT.md` (self-tests, `MC_SMOKE_PERF`)
  - `docs/ARCHITECTURE.md`
- Speed:
  - `electron.vite.config.ts`
  - `src/main/git.ts`
  - `src/main/smoke.ts`
  - `src/main/indexer.ts`
  - `src/main/index.ts`
  - `src/renderer/src/App.tsx` (lazy pages, `OnceShown`, coalesced refresh)
  - `Md.tsx` / `MdRender.tsx`, `NoteMarkdown.tsx` / `NoteMarkdownRender.tsx`
  - `terminalBus.ts`
- UI (`src/renderer/src/components/`):
  - `Sidebar.tsx`
  - `TopBar.tsx`
  - `StatusBar.tsx`
  - `HomeView.tsx`
  - `dashboard.css`
  - `styles.css`
- Release: `scripts/release.mjs`, `package.json`.
