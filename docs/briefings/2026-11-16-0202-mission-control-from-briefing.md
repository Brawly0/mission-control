# Session briefing: README titles, Briefing auto-send, My PC advisor (2026-11-15/16)

## Goal

Fix small annoyances in Mission Control and add **My PC**, a permanent "personal PC advisor" workspace for general
computer help that replaces using the "C: drive" project. Ship each step as a release.

## Done and verified

| Item | State |
| --- | --- |
| Project names were `p align="center">` for READMEs opening with an HTML hero | ✅ fixed in `readmeInfo`/`pickHeading`, checked on real READMEs (PcsConnector, course-scheduler, WBP, NASA, Space App Challenge). **Released v0.34.0** (`896f310`) |
| Dark-theme glass project avatars (left uncommitted by the previous session) | ✅ shipped in v0.34.0 |
| Briefing button / Broadcast didn't send (Enter landed inside a paste burst) | ✅ `sendPrompt` writes the text, then `\r` 250 ms later. Unit-tested; **not tried in a live agent** |
| My PC advisor + C: drive folded in (ADR 0041) | ✅ **Released v0.35.0** (`604ad8e`), release gates PASS |
| PowerShell survey on the real PC | ✅ about 8 s, valid JSON via `-Command`, UTF-8 OK (emoji app names). Found 86 apps, 12 startup items, C: 436 GB used / **19 GB free** |
| `npm run typecheck && npm run build`, 371 tests, `MC_SMOKE_POLISH=1` tour (Ask my PC box in dark/light, 1440/960) | ✅ |

**Not verified yet:** the C: fold and profile/ABOUT-ME creation in the *installed* app (they run on first start of
0.35.0; self-tests skip them), and a real My PC chat (trust prompt, `--add-dir C:\ …`, connectors loading).

## How My PC works

- Folder `~/My PC` (`C:\Users\bsbra\My PC`). Files are created only if missing, never overwritten:
  - `CLAUDE.md`: advisor rules. Read the three files below first, inspect before answering, give one recommendation, **ask before changing anything** or acting in the user's name online. No writes to Windows, Program Files, AppData or `~/.claude`.
  - `PC-PROFILE.md`: written by the app (survey + project list + MCP servers). Refreshed when older than a day: 20 s after start, every 6 h, and when a chat opens. The first chat waits for it.
  - `ABOUT-ME.md`: seeded with the user's name; the advisor keeps it current.
  - `PC-LOG.md`: the advisor's dated log.
- Chats run `claude <prompt> --add-dir C:\ D:\ …`. The prompt **must come before** `--add-dir`, which is variadic (`myPcArgs`). No `mcpAllow`, so every connector loads.
- Ways in: the **Ask my PC** box on Home (Enter sends, empty opens), 4 starter chips, palette "Ask my PC", **Ctrl+Alt+P**.
- C: fold: store `mergedProjects['c:'] = <My PC>`, `myPcVersion: 2`. Chat target order: your own move, then the automatic project match, then the merge. Merged sources are filtered out of `listProjects`. Resuming an old C: chat still runs in `C:\`.

## Decisions and why

- **Permanent folder, not `C:\`**: Claude Code keys history and memory by folder; a CLAUDE.md at the drive root needs admin rights.
- **The app writes the profile, not the advisor**: it's ready before the first question, the result is predictable, and it's cheap (read-only CIM and registry queries).
- **The store migration lives in a pure `applyMyPcSetup`** (`myPcTemplate.ts`), so it's unit-testable without Electron.
- **Delayed Enter instead of one write**: Claude Code and Codex treat a long burst as a paste and turn the trailing `\r` into a newline.
- **The GitHub-profile briefing stays uncommitted**: the repo is public and that file names the user's teammates.

## Open problems

- Watch the first start of 0.35.0. Check that C: drive is gone from the sidebar, its 21 chats sit under My PC (or under real projects), and My PC is pinned with the Cpu icon.
- `compactAgent` still writes `'/compact\r'` in one go. It's short, so probably fine; switch it to `sendPrompt` if it ever fails to send.
- The new user-level `~/.claude/CLAUDE.md` holds personal context (live trading bot in Desktop\bot, short answers). Consider mentioning it in the My PC `CLAUDE.md` or `ABOUT-ME.md` seed.
- The GitHub MCP server fails to connect (bad auth header), so the advisor won't have GitHub until that's fixed.

## Next steps

1. The user restarts on 0.35.0 (Settings → Check now → Restart). Confirm the sidebar, `C:\Users\bsbra\My PC\PC-PROFILE.md` and `ABOUT-ME.md`.
2. Open My PC (Ctrl+Alt+P) and ask "Free up disk space". Check that it reads the files, uses `--add-dir`, and asks before deleting.
3. Next planned work, per the user: **change the project logos**.

## Gotchas

- **Git Bash heredocs collapse `\\` to `\`** in this environment. Write TS containing backslashes with the Write/Edit tools, or use `String.raw` (bit this session twice).
- No Python on this machine. Use node or PowerShell for scripts.
- Importing `src/main/myPc.ts` (or anything that pulls in `hub.ts`) in vitest fails because Electron is unavailable. Keep testable logic in `myPcTemplate.ts` / `src/shared`.
- `normalizePath('C:\\')` is `'c:'`.
- Commit and release only when the user asks in that turn. The auto-mode classifier blocks them otherwise.
- Release: bump `package.json`, then `npm run publish-release -- "notes"` (about 5 min). A `release` skill now exists for this.

## Files that matter

- `src/main/myPc.ts`: `prepareMyPc` (startup, sync), `ensureMyPc` (IPC), `driveRoots`, survey script, `refreshPcProfile`.
- `src/main/myPcTemplate.ts`: CLAUDE.md / ABOUT-ME templates, `pcProfileMarkdown`, `applyMyPcSetup`, `MY_PC_SETUP_VERSION`.
- `src/main/claudeData.ts`: `matchStrayChats` (merge fallback), `listProjects` (hides merged sources).
- `src/main/store.ts`: `mergedProjects`, `myPcVersion`.
- `src/main/index.ts`: startup hook (skipped under `MC_SMOKE`). `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`: `chat:myPc` / `myPc()`.
- `src/renderer/src/app/myPc.ts` (`askMyPc`, suggestions), `components/HomeView.tsx` (`AskMyPc`), `home.css` (`.hd-askpc*`), `shortcuts.ts`, `app/commands.ts`, `app/shortcutActions.ts`.
- `src/shared/terminalInput.ts`: `sendPrompt`. `src/shared/projectLook.ts`: `pickHeading`, `readmeInfo`, `myPcArgs`.
- Tests: `src/main/myPc.test.ts`, `src/shared/projectLook.test.ts`, `src/shared/terminalInput.test.ts`.
- Docs: `docs/decisions/0041-my-pc-advisor.md`, `docs/ROADMAP.md` (0.34.0, 0.35.0 sections), `docs/ARCHITECTURE.md`.
