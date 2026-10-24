# Session briefing: Read the session briefing at…

Oct 24, 2026, 10:32 PM · Mission Control · the chat reached its limit at about 374K tokens. Saved by Mission Control.

To pick up where it left off, start a new chat and ask Claude to read this file. To reopen the original chat instead: `claude --resume 29451da6-7c37-4fbb-a576-e8c41fa3ec18` (full transcript: `C:\Users\bsbra\.claude\projects\C--Users-bsbra-Desktop-claude-hub\29451da6-7c37-4fbb-a576-e8c41fa3ec18.jsonl`).

---

Summary:
# Session briefing: Mission Control v0.12 → v0.15

## 1. Goal and what the user asked for

**Mission Control** is a Windows desktop app (Electron + React 19 + TypeScript) that manages Claude Code projects, chats, agents, tasks, docs and spending. The repo is `C:\Users\bsbra\Desktop\claude-hub` (private `Brawly0/claude-hub`). Releases go to the public repo `Brawly0/mission-control-releases`, and the installed app updates itself on restart.

**What the user asked for this session, in order:**
1. Read the v0.12 briefing, summarize where things stand, and wait for a go-ahead.
2. See token limit and usage 24/7 (weekly limit, what's left) in the top bar → **v0.13**.
3. "no update appeared i dont see them" → this was taken as consent to release; v0.13.0 was released.
4. Build the pace forecast, plus an Obsidian-like docs folder per project, written by the AI so everything is clear for Claude, "good with UI" → **v0.14**.
5. Make a Skills page, a skill that coaches long chats to use fewer credits, and an Eco mode → **v0.15**.
6. "what should we work on and we need in our program" → I recommended a fresh chat, a hands-on check, then plan cost per chat.
7. Write a session briefing to `docs/briefings/2026-10-24-2136-mission-control-from-briefing.md` (goal, done/verified, decisions and why, open problems, exact next steps, gotchas, files that matter; skimmable), then give the path. **Done.**

## 2. Rules and constraints (verbatim, from CLAUDE.md and decisions)

- "Never write to `~/.claude/`. It's read-only for this app. App data goes through `src/main/store.ts`."
- "Always run `npm run typecheck && npm run build` after changes."
- "Session JSONL files can be 30+ MB: never read a whole file just to list sessions."
- "New IPC: `src/shared/types.ts` (MissionControlApi) → `src/preload/index.ts` → handler in `src/main/index.ts`."
- "Plain CSS with variables in `src/renderer/src/styles.css`; no UI framework."
- "Tick finished items in `docs/ROADMAP.md` and add an ADR in `docs/decisions/` for notable choices."
- No email in the UI; use the GitHub noreply address for commits. Every dashboard number must be real.
- OAuth token in `~/.claude/.credentials.json`: read only, sent only to `api.anthropic.com`, never logged or stored, **never refreshed** (refreshing rotates the refresh token and would log Claude Code out).
- Commit only when asked. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Compaction-summary instructions from CLAUDE.md:** write the summary as a session briefing: goal, done and verified, decisions and why, open problems, exact next steps, gotchas, files that matter.

## 3. Done and verified

**Releases:** v0.13.0, v0.14.0 and v0.15.0 are released, tagged and pushed (each release has 3 assets, not drafts). The working tree was clean after the v0.15 commit. 103 unit tests pass; typecheck and build are clean. The briefing file is written; the summary-instructions note says it is uncommitted, though git status never showed it, so check before committing.

**v0.13: plan limits**
- `src/main/planUsage.ts` polls `GET https://api.anthropic.com/api/oauth/usage` (headers `Authorization: Bearer`, `anthropic-beta: oauth-2025-04-20`):
  - every 3 minutes, on window focus (at most once per 20 s), and on demand;
  - backs off up to 15 minutes on HTTP 429;
  - on failure keeps the last numbers and shows the error.
- `src/shared/planUsage.ts` has the pure parser `parsePlanUsage` (converts 0–100 to 0–1, reads `extra_usage` cents), plus `WINDOW_LABELS`, `windowLabel`, `resetsIn` and `duration`.
- `setRateLimit` in `tasks.ts` is the single source for plan numbers (both the poll and task events).
- The top-bar `PlanMeter.tsx` shows Session/Week bars, %, reset countdown and a tooltip. The status-bar plan item was removed.
- The Usage card shows % used and left, reset times, plan, extra usage and a "Check now" button. Home meters use the same data.
- Alerts: `checkPlanLimits` in `index.ts`, with setting `planAlertPercent` (default 80, 0 = off) and store `limitAlerted`. Kinds are near, out and pace; keys round the reset time to the minute.
- New IPC: `ratelimit:refresh`.

**v0.14: pace forecast and docs vault**
- `forecast()`:
  - Session: last hour of readings once there are ≥15 minutes of them, otherwise the window average.
  - Weekly: average since window start (`resetsAt` minus 5 h or 7 d).
  - Returns `{ratePerHour, atReset, runsOutAt, basis}`, with `paceText` for display.
  - Readings are kept in memory only (`samples` Map in `main/planUsage.ts`, up to 120).
- UI: a faint projected bar, "out in …" in orange when a limit will run out before reset, and a pace line on the Usage card.
- Docs vault:
  - `src/shared/vault.ts`: frontmatter (including `|` and `>` block text), wikilinks and relative `.md` links, `resolveLink`, `headings`/`slugify`, `wikilinksToMarkdown` (`mc-note:` scheme), and the prompts `buildVaultPrompt`/`updateVaultPrompt`.
  - `src/main/vault.ts`: scans root `.md` files plus `docs/**` (cap 600 files, depth 6), watches with `fs.watch` (recursive on `docs/`; re-watches when `docs/` appears), and runs `buildVault` as a headless task titled `Docs vault: build|update` (permission `acceptEdits`, Sonnet by default, no worktree).
  - Auto-update after compactions when `ProjectMeta.autoDocs` is on and `automationHold` allows it.
- UI files: `VaultView.tsx` (tree, note, outline, links, backlinks, graph, hero, build dialog), `VaultGraph.tsx` (force layout in SVG; loose notes kept on a rim; centered on the linked notes), `NoteMarkdown.tsx` (`remark-gfm@4.0.1` added, properties, links), `vault.css`.
- `DocViewer` gained `onLink`, `exists`, `onContent`, `actions` and a `version` prop for live re-reads. `docs:write` now creates missing folders. `DocsPanel.tsx` was deleted.

**v0.15: Skills page, eco:coach and Eco mode**
- `src/shared/skills.ts`:
  - `BUILTIN_COMMANDS` (`/x` deliberately not included);
  - `skillUsesIn(e)`: assistant `tool_use` named `Skill` (`input.skill`), and user `<command-name>/name</command-name>`;
  - `roughTokens`, `coachLevel` (60% and 85% of the window), `coachMessage`.
- Index schema 7 (`indexWorker.ts`): table `skill_uses(session_id, use_id, ts, skill, how)` and query `skillUsage(since)`.
- `src/main/skills.ts` `listSkills`:
  - personal skills in `~/.claude/skills`, following links (most are links to folders elsewhere);
  - plugin skills via `installed_plugins.json` (`installPath/skills`, name from `plugin.json`);
  - project skills in `.claude/skills`;
  - Mission Control's own `eco:coach`.
- `addEcoSkillToProject` writes `.claude/skills/eco-coach/SKILL.md` into a project.
- `src/main/ecoPlugin.ts`: `ECO_SKILL` text and `writeEcoPlugin` → `%APPDATA%\Mission Control\plugins\eco` (`.claude-plugin/plugin.json` name `eco`, `skills/coach/SKILL.md`).
- `src/main/eco.ts`:
  - `ecoSettings()` merges defaults `{enabled:false, model:'sonnet', effort:'', autocompactTokens:150000, coach:true, skill:true}`.
  - `ecoLaunchArgs()` uses `=` forms: `--effort=`, `--autocompact=150k`, `--plugin-dir=`.
  - `ecoModel()`.
  - `coachPrompt(sessionId)`: each level said once per chat; a plan note when the 5-hour limit is ≥85% or on pace to run out within the hour.
- `spend.ts`: `defaultModelFor` falls back project default → task default → `ecoModel()`; `launchArgs` appends `ecoLaunchArgs()`.
- `hookServer.ts`: `startHookServer(onEvent, coach?)` answers `UserPromptSubmit` with `{hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext}}` within 1.5 s.
- UI:
  - `SkillsView.tsx`: Eco card; tip about unused skills; filters, sort and period; detail panel with "Use in new chat" (launches `/<id>` in the selected project or a quick chat); "other" source labeled "Built-in or removed".
  - `EcoFields` in `SettingsDialog` (Spending tab; `initialTab` prop added).
  - Top-bar Eco toggle (right-click opens settings).
  - Shortcuts `goSkills` (Ctrl+Alt+K) and `toggleEco` (Ctrl+Alt+L); palette entries; sidebar "Skills" (Wand2 icon); `View` gains `'skills'` in both type definitions; `skills.css`.
- IPC: `skills:list`, `skills:usage`, `skills:addEco`.

**Smoke tours** (in `smoke.ts`):
- `MC_SMOKE_PLAN=1`: real plan numbers, screenshots.
- `MC_SMOKE_VAULT=<dir>`: sample vault, links, watcher, graph, hero, dialog.
- `MC_SMOKE_SKILLS=1`: 27 skills (23 personal, 3 plugin, 1 eco); Eco flags; coach round trip through the hook server; screenshots; settings restored afterwards.

**Verified with one real CLI call:** `claude -p --model haiku --effort low --autocompact 150k --plugin-dir …` loads `eco:coach`. `--autocompact` accepts 100k–1M.

**Docs:** README (v0.13/14/15 feature sections), ROADMAP (v0.13/14/15 ticked), ADRs 0013 (plan limits, with a pace section), 0014 (docs vault) and 0015 (skills and eco), ARCHITECTURE, DEVELOPMENT (all three tours).

## 4. Not verified yet

- A real "Build vault with Claude" run.
- Eco in a real interactive chat.
- Real notifications.
- From v0.12: an automatic briefing save after a real compaction, and the mouse-only checks.

## 5. Errors and fixes

- **Git Bash heredocs with quotes or backslashes failed** with "unexpected EOF". Fix: write `.cjs` patch scripts into the scratchpad with the Write tool and run them with `node`.
- **Top bar overlapped the New button.** Fix: the search box is now `flex: 1 1 240px; max-width: 480px`, and the meter has `flex-shrink: 0`.
- **Graph orphans pushed far out**, shrinking the cluster. Fix: stronger gravity (0.05), a rim clamp, centering on linked notes, and a symmetric viewBox.
- **CLAUDE.md and README both showed as "Demo app".** Fix: root files are titled by file name.
- **Only 3 personal skills found.** Fix: follow links to folders.
- **Coach wording for huge chats.** It said "close to auto-compaction" for a 944k chat; now it says "far past the point where compacting pays off".
- **"Resets in Fri 6:59 AM" wording.** Fix: reset times more than a day out read "resets Fri …".
- **`--effort bogus` test** only warns, so it ran a real one-word chat on the default model. I told the user.
- **My CLI tests created a "Temp" project** in the sidebar (`~/.claude/projects/C--Users-bsbra-AppData-Local-Temp`). The user may delete it; the app must not.

## 6. All user messages

1. "Read the session briefing at "C:\Users\bsbra\Desktop\claude-hub\docs\briefings\2026-10-24-1449-mission-control-v0-12.md". It's the handoff from the previous session on this project. Then tell me in a few lines where things stand and what you'd do next, and wait for my go-ahead."
2. "ok i want you to work on something i want to be able to see my token limit and usage 24/7 whether that will be on the top bar or bottom or where you see it perfect i want to see my weekly limit how much i got left and this important stuff"
3. "no update appeared i dont see them"
4. "what should we do next"
5. "build the pace forecast and also iwant you for each projet build like a doc folder automatically like obsidian that has all the documentaion there from theai so everything is clear for claude and make it goodwith ui"
6. "what next we can work on maybe being eco with the usage bringing it dows and the use of skills"
7. "yes make a skills page and how about we make a skill that makes claude use less credits by coaching long chats and add an eco mode"
8. "what should we work on and we need in our program"
9. "Write a session briefing for the next session to docs/briefings/2026-10-24-2136-mission-control-from-briefing.md: the goal, what's done and verified, decisions and why, open problems, the exact next steps, gotchas, and the files that matter. Keep it skimmable. Then tell me the path."

## 7. Pending

- Tell the user the briefing path: `C:\Users\bsbra\Desktop\claude-hub\docs\briefings\2026-10-24-2136-mission-control-from-briefing.md`.
- The briefing file is uncommitted. Only commit if asked.

## 8. Next steps (from the briefing; don't start without the user's go-ahead)

1. **Hands-on check with the user (about 30 min):**
   1. Turn Eco on and start a chat. Check it runs on Sonnet and `/eco:coach` works.
   2. Build the vault on a small project and review the notes.
   3. Watch for the coach note in a long chat.
   4. Fix whatever's off.
2. **Plan cost per chat (% of the weekly limit):**
   1. Persist the plan readings (today they're in memory only).
   2. Compare plan-% changes with token use in the `msgs` table to get "1% of the week ≈ N tokens, per model".
   3. Show it on chats, tasks, projects and vault builds.
   4. Use it to measure whether Eco saves anything.
3. **"Needs you" inbox and daily digest.**
4. **Housekeeping:** split `App.tsx` (over 1,100 lines); code signing (needs a certificate from the user); drop "BRIEFING.md generator" from the roadmap.

## 9. Open problems

- The weekly forecast is noisy early in the week.
- The "Temp" project left by the CLI tests.
- The GitHub MCP server fails with a bad auth header. The `gh` CLI works and is what releases use.
- No code signing, so SmartScreen warns on install.

## 10. Gotchas

- **Release steps:**
  1. Bump `package.json` with node (PowerShell `Set-Content` adds a BOM).
  2. Commit and push.
  3. `node scripts/release.mjs "<notes>"`
  4. `git tag vX && git push origin vX`
- **Running a smoke tour:** `$env:MC_SMOKE="<dir>\s.png"; $env:MC_SMOKE_LOG=...; $env:MC_SMOKE_<TOUR>=...; .\node_modules\electron\dist\electron.exe .`
- Smoke runs don't poll plan usage unless `MC_SMOKE_PLAN=1`.
- The installed app shares `store.json` with dev runs; smoke tours that change settings must restore them.
- Index schema 7: bumping it drops the tables and rebuilds the whole index on first start.

## 11. Files that matter

- **Plan limits:** `src/main/planUsage.ts`, `src/shared/planUsage.ts`, `src/renderer/src/components/PlanMeter.tsx`, `UsageView.tsx`, `checkPlanLimits` in `src/main/index.ts`.
- **Vault:** `src/main/vault.ts`, `src/shared/vault.ts`, `VaultView.tsx`, `VaultGraph.tsx`, `NoteMarkdown.tsx`, `vault.css`.
- **Skills and Eco:** `src/main/skills.ts`, `src/main/eco.ts`, `src/main/ecoPlugin.ts`, `src/shared/skills.ts`, `src/main/hookServer.ts`, `src/main/spend.ts`, `SkillsView.tsx`, `SettingsDialog.tsx`, `TopBar.tsx`, `skills.css`.
- **Index:** `src/main/indexWorker.ts`.
- **Smoke tours:** `src/main/smoke.ts`.
- **Decisions:** `docs/decisions/0013-plan-limits.md`, `0014-docs-vault.md`, `0015-skills-and-eco-mode.md`.
