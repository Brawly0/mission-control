# Session briefing: "New session from latest briefing" picked an old briefing (2026-11-18)

## Goal

Fix **New session from latest briefing** (ProjectView menu, Ctrl+Alt+B) so it opens the project's newest briefing. It was opening an older one: the Nov 12 GitHub briefing instead of the Nov 18 one.

## Done and verified

- **Cause:** `latestBriefing()` in `src/main/briefings.ts` returned the newest *auto-saved* briefing (from compactions, tracked in `store.briefingsSaved`) whenever one existed. Briefings written by "Write briefing" or the handoff in `docs/briefings/` were only a fallback, so a newer hand-written one never won.
- **Fix:** both sources are now collected into one set (auto-saved paths for this project plus every `.md` in `<project>/docs/briefings/`) and the newest wins. A new helper `briefingTime()` ranks each file by the `YYYY-MM-DD-HHMM` prefix of its name, falling back to its mtime.
- Verified:
  - `npm run typecheck` and `npm run build` pass.
  - The same ranking logic, run with node on the real `docs/briefings/` folder, picks `2026-11-18-1235-mission-control-from-briefing.md`.
- **Not verified:**
  - Clicked through in the running app.
  - The smoke test (`brief: latest briefing found` in `src/main/smoke.ts:636` should still pass; it writes a fresh file in a temp folder).
- **Not committed.** Working tree: `src/main/briefings.ts` changed, plus untracked briefings in `docs/briefings/` (including this one).

## Decisions and why

- **Rank by the file-name timestamp, not mtime.** Editing an old briefing changes its mtime and would wrongly make it "latest". Every briefing name starts with `briefingFileName()`'s `YYYY-MM-DD-HHMM` (`src/shared/projectLook.ts:349`). mtime is only the fallback for names without one.
- **Only `<project>/docs/briefings/` is scanned, not `folderFor()`'s userData folder.** That folder mixes briefings from every folder-less chat, so scanning it could return another project's briefing.

## Open problems

- The installed app keeps the bug until a release ships (current version 0.40.0).
- Leftover from the Nov 12 GitHub work: the profile bio, website and contact line are waiting on the user's LinkedIn or portfolio link, and on whether their email should be public.

## Next steps

1. Ask the user before committing (commit message ending with the Co-Authored-By line).
2. With their yes, release **0.40.1** using the `release` skill (it bumps, verifies, commits, publishes to `Brawly0/mission-control` and checks the release). Pushing and publishing need an explicit yes.
3. Optional: run the briefing smoke test (see `docs/DEVELOPMENT.md`) and try Ctrl+Alt+B in the app.
4. Tick or add the fix in `docs/ROADMAP.md` if it's listed there.

## Gotchas

- Never write to `~/.claude/`. App data goes through `src/main/store.ts`.
- Briefings for chats started from `C:\` get re-homed to their project through `movedChatList()` (`projectOf()` in `briefings.ts`). That's how the Nov 12 briefing counted as Mission Control's.
- The user wants short, direct answers with one recommendation, and asks to be consulted before anything outward-facing.

## Files that matter

- `src/main/briefings.ts`: `latestBriefing()` and `briefingTime()` (the fix).
- `src/renderer/src/App.tsx:538`: `startFromBriefing` calls `window.mc.latestBriefing`.
- `src/main/handoff.ts`: also uses `latestBriefing`.
- `src/shared/projectLook.ts:349`: `briefingFileName()` (the name format the ranking relies on).
- `src/main/smoke.ts:622`: `briefTour` smoke check.
