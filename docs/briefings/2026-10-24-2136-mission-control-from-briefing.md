# Session briefing: Mission Control v0.13 → v0.15

Oct 24, 2026 · Mission Control (`C:\Users\bsbra\Desktop\claude-hub`) · follows `2026-10-24-1449-mission-control-v0-12.md`

To pick up: read this, then `CLAUDE.md` and `docs/ROADMAP.md`. Turn **Eco mode on** for the new session.

---

## Goal

**Mission Control** is a Windows desktop app (Electron + React + TypeScript) for running Claude Code: projects, chats, agents, tasks, docs and spending in one place.

- **This session's theme:** see your plan limits all the time, and use less of them.
- **The user:** Pro plan, often near the limits. About 99% of their usage is Opus, and almost all tokens are long chats being re-read on every reply.

## Where things stand

- **Latest release:** v0.15.0 is released (tags `v0.13.0`, `v0.14.0`, `v0.15.0`) and pushed to `main`; the working tree was clean at release.
- **Updates:** the installed app updates itself on restart.
- **Checks:** 103 unit tests pass (`npm test`); typecheck and build are clean.

| Version | What |
|---|---|
| v0.13 | **Plan limits in the top bar** (Session / Week meters, reset countdown), polled every 3 minutes from the account. Usage card with % left and extra usage. Alerts at a set level (default 80%) and when a limit runs out. |
| v0.14 | **Pace forecast**: projected bar, "out in …", a pace line on Usage, early alert. **Docs vault per project** (Docs tab): Claude builds `docs/` as an Obsidian-style vault. Tree, `[[wikilinks]]`, backlinks, outline, graph, live updates, new note. Opt-in "Keep up to date" after compactions. |
| v0.15 | **Skills page** (Ctrl+Alt+K): personal, plugin and project skills, usage from the index, context cost. **eco:coach skill** (a plugin). **Eco mode** (🍃 in the top bar, Ctrl+Alt+L): Sonnet default, `--autocompact=150k`, optional `--effort`, the eco plugin, and a long-chat coach through the hook server. |

## Verified vs not

**Verified** by smoke tours, screenshots and unit tests:
- The plan endpoint returns real numbers, and the meters and Usage card show them.
- Forecast math.
- Vault: parsing, links and backlinks, the live watcher, graph, empty state and build dialog. All on a sample vault.
- Skills: 27 found (24 personal, which needed links followed; 3 plugin; eco:coach) and usage counts from the index.
- Eco: launch flags; the plugin loads as `eco:coach` (one real Haiku call); the coach answers through the real hook server.

**Not verified yet** (the user hasn't used these by hand):
- **A real "Build vault with Claude" run.** Note quality is unknown, and so is whether the "Project docs" section lands in CLAUDE.md.
- **Eco in a real interactive chat:** Sonnet, autocompact and `/eco:coach` available, and the coach note actually shaping Claude's reply.
- **Real notifications:** the limit, pace and vault ones.
- **From v0.12:** an automatic briefing save after a real compaction, plus the mouse-only checks (Briefing button, rebinding a shortcut, zoom, the New project dialog).

## Decisions (and why)

- **Plan data comes from `GET api.anthropic.com/api/oauth/usage`** (header `anthropic-beta: oauth-2025-04-20`), the same source as `/usage`. It uses the token in `~/.claude/.credentials.json`, read only. **Never refresh the token**: that rotates the refresh token and would log Claude Code out. When it's expired, keep the last numbers and show a hint. (ADR 0013)
- **One source of truth for plan numbers:** both the poll and task runs go through `setRateLimit` in `tasks.ts`.
- **The vault is the project's `docs/` folder plus the root `.md` files.**
  - Claude writes it as a normal headless task titled `Docs vault: build` or `Docs vault: update`, with Sonnet by default and `acceptEdits`.
  - CLAUDE.md gets a "## Project docs" pointer, but only on a build the user starts.
  - Auto-update is opt-in per project, so it never spends the plan unasked. (ADR 0014)
- **Eco only changes what Mission Control launches.**
  - A project's default model and the task default still beat the Eco model.
  - Flags use the `=` form so a prompt after them isn't swallowed as a value.
  - The skill ships through `--plugin-dir` from `%APPDATA%\Mission Control\plugins\eco`; nothing is written to `~/.claude`.
  - The coach speaks once at 60% and once at 85% of the compaction window, plus a plan note per 5-hour window. (ADR 0015)
- **The Skills page only reads.** It flags unused skills but never removes them.

## Open problems

- **This chat got very long.** That's why the work continues from this briefing.
- **The weekly forecast is noisy** early in the week, because it uses the average since the week started.
- **A stray "Temp" project** sits in the sidebar, from test chats run in `%TEMP%`. Its folder is `~/.claude/projects/C--Users-bsbra-AppData-Local-Temp`; the user can delete it, but the app must not.
- **`App.tsx` is over 1,100 lines** and every feature touches it.
- **No code signing**, so SmartScreen warns on install.
- **The GitHub MCP server failed** (bad auth header). The `gh` CLI works and is what releases use.

## Next steps (exact)

1. **Hands-on check of v0.13–v0.15 with the user (about 30 min):**
   1. Turn Eco on and start a chat. Check the model is Sonnet and `/eco:coach` works.
   2. Build the vault on one small project and review the notes.
   3. Watch for the coach note in a long chat.
   4. Fix whatever's off.
2. **Plan cost per chat (% of the weekly limit).**
   1. Persist the plan readings. Today they're in memory only, in `src/main/planUsage.ts` (`samples`).
   2. Compare plan-% changes with the indexed token use over the same time (the `msgs` table) to get "1% of the week ≈ N tokens, per model".
   3. Show the result on chats, tasks, projects and vault builds.
   4. Use it to measure whether Eco actually saves anything.
3. **"Needs you" inbox and daily digest:** agents waiting for permission, tasks to review, due reminders, limit and pace alerts, vault builds.
4. **Housekeeping:**
   - Split `App.tsx`.
   - Code signing (needs a certificate from the user).
   - Drop "BRIEFING.md generator" from the roadmap; the vault replaced it.

## Gotchas

- **Writing scripts:** Git Bash heredocs that hold quotes and backslashes often fail with "unexpected EOF". Write `.cjs` patch scripts with the Write tool into the scratchpad and run them with `node`.
- **PowerShell `Set-Content`** adds a BOM, which breaks `package.json`. Edit the version with node.
- **The installed app shares `%APPDATA%\Mission Control\store.json`** with dev runs. Smoke tours that change settings must restore them; the skills tour does.
- **Index schema is 7.** Bumping it drops the tables and rebuilds the whole index on first start.
- **Smoke runs don't poll plan usage** unless `MC_SMOKE_PLAN=1`.
- **Free smoke tours:**
  - `MC_SMOKE_PLAN=1`
  - `MC_SMOKE_VAULT=<empty dir>`
  - `MC_SMOKE_SKILLS=1`
  - plus the older `SHOTS`, `HUB`, `BRIEF`, `NAMES`, `SPEND`.
- **Running a smoke tour:** `$env:MC_SMOKE="<dir>\s.png"; $env:MC_SMOKE_LOG="<dir>\s.log"; $env:MC_SMOKE_<TOUR>=...; .\node_modules\electron\dist\electron.exe .`
- **CLI tests can cost plan.** A bad `--effort` value only warns and still runs the chat, so test with `--model haiku`. `--autocompact` accepts 100k to 1M.
- **Personal skills are mostly links** to folders elsewhere; follow them when reading.
- **Release steps:**
  1. Bump `package.json`.
  2. Commit and push.
  3. `node scripts/release.mjs "<notes>"`
  4. `git tag vX.Y.Z && git push origin vX.Y.Z`

## Files that matter

- **Plan limits:**
  - `src/main/planUsage.ts`: the poller and forecast samples.
  - `src/shared/planUsage.ts`: parsing, `forecast`, `paceText`. Tested.
  - `src/renderer/src/components/PlanMeter.tsx`
  - `UsageView.tsx` (`PlanLimits`)
  - `checkPlanLimits` in `src/main/index.ts`
- **Vault:**
  - `src/main/vault.ts`: scan, watch, build task.
  - `src/shared/vault.ts`: frontmatter (including block text), links, prompts. Tested.
  - `src/renderer/src/components/VaultView.tsx`, `VaultGraph.tsx`, `NoteMarkdown.tsx`
  - `src/renderer/src/vault.css`
- **Skills and Eco:**
  - `src/main/skills.ts`
  - `src/main/eco.ts`: flags and `coachPrompt`.
  - `src/main/ecoPlugin.ts`: the skill text.
  - `src/shared/skills.ts`: transcript parsing, coach wording. Tested.
  - `src/main/hookServer.ts`: `UserPromptSubmit` reply.
  - `src/main/spend.ts`: `launchArgs`, `defaultModelFor`.
  - `src/renderer/src/components/SkillsView.tsx`, `SettingsDialog.tsx` (`EcoFields`), `TopBar.tsx`
  - `src/renderer/src/skills.css`
- **Index:** `src/main/indexWorker.ts` (`skill_uses`, `skillUsage`).
- **Smoke tours:** `src/main/smoke.ts` (`planTour`, `vaultTour`, `skillsTour`).
- **Decisions:** `docs/decisions/0013-plan-limits.md`, `0014-docs-vault.md`, `0015-skills-and-eco-mode.md`.
