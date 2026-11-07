# Session briefing: Briefing button fix + vibe coding stats (0.30.0)

_2026-11-06 00:08 · previous session 2cd067d5_

## Goal

1. Bring back the missing **Briefing** button on agent cards.
2. Add stats to **Home**: Claude and Codex token totals, time spent vibe coding, and fun facts about spending. The user asked for them to be **100% accurate**.
3. Release both as **0.30.0**.

## Status

| Item | State |
|---|---|
| Briefing button | ✅ Fixed and shipped |
| Vibe coding stats on Home | ✅ Shipped, checked against real data |
| v0.30.0 release | ✅ Published as Latest on `Brawly0/mission-control-releases`: installer, blockmap, `latest.yml`, `SHA256SUMS.txt` |
| Source push | ❌ **Not pushed.** Commit `84fc067` exists only locally because `Brawly0/claude-hub` is archived |
| Tests and gates | ✅ 359 tests, typecheck, build, dev and packaged release gates, and the update check all pass |

### How the numbers were checked (real data, 2026-11-05)
- **Claude:** ≈ 8.07B tokens, ≈ $4,884 at API list prices, 20,802 replies, 115 chats. A separate raw JSONL count matched; the only gaps came from chats still running between the two counts.
- **Codex:** ≈ 335.6M tokens across 53 chats.
- **Time:** 220h 32m. A separate sweep-line calculation gave **exactly** the same figure. Longest day was 15 Sep (16h 27m); longest streak was 28 days.

## Decisions and why (ADR 0036)

- **Claude tokens** come from the `msgs` table: one row per (session, msg_id), keeping the largest counts seen across streamed lines, so nothing is counted twice. Total = input + cache write 5m + cache write 1h + cache read + output.
- **Codex tokens** use the last `total_token_usage` in each rollout. Total = input + output, because input already includes cached tokens and output already includes reasoning. Adding cached or reasoning tokens again would double-count.
- **Time** works as follows:
  - Within one chat, a gap of **15 minutes or less** between messages counts as time; a longer gap is a break.
  - Every Claude API call counts as a message, so time agents spend working on their own counts too.
  - Spans from all chats are **merged**, so the total is clock time. `parallelMinutes` is each chat's time added up, minus that clock time.
  - The total is not keyboard tracking. The UI says so.
- **Dollar figures** are estimates at Anthropic's API **list prices**, recomputed per model from `pricing.ts`. They are not what the plan charges, and the UI states this. **Codex gets no dollar figure** because there's no reliable price for it.
- **The weekly card** on Home switched from the per-chat sum (4h 11m) to clock time (3h 5m), so it agrees with the new panel.
- **Scope:** the release also shipped the already-uncommitted **Prompt Studio** and **live CLI task teams** work, which was already versioned as 0.30.0 and couldn't be split out.

## Open problems

- **The source repo `Brawly0/claude-hub` is archived** on GitHub, so `git push` returns 403. The user hasn't decided whether to unarchive it. **Don't unarchive it without asking.**
- `docs/briefings/2026-11-05-1322-mission-control-briefing-button.md` is untracked; commit it along with this file.

## Exact next steps

1. Ask the user whether to unarchive `claude-hub`. If yes:
   ```
   gh api -X PATCH repos/Brawly0/claude-hub -F archived=false
   git push origin main
   ```
2. Commit both briefing files (the user is fine with commits that are part of a release or push request).
3. Optionally, once the user has run the update, look over Home in the installed 0.30.0: check the fun facts wording and that the panel collapses at narrow widths below 900px.

## Gotchas

- **When a repo is archived, `gh` reports "workflow scope may be required".** That message is misleading; the token already has `repo` and `workflow` scopes. Check first: `gh api repos/Brawly0/<repo> --jq .archived`. See memory note `github-repos-archived`.
- **A Codex rollout can lack a token count in its last 64 KB.** `readChat` in `codexData.ts` then reads the whole file to find the last total. This applies only to Codex rollouts; Claude JSONL is never read in full, as CLAUDE.md requires.
- **Smoke screenshots can come out stale.** `statsTour` calls `webContents.invalidate()` and sleeps 600 ms before capturing. Without that, the PNG showed the previous view.
- **Timing in tests:** 10:30:01 to 10:40 is 9m59s, not 10m. The vibe-time tests use second-precise timestamps.
- **New Codex sessions appearing about every 90s** come from the user's own `codex exec` runs in "Love Website". That's normal.
- **The release flow:** `node scripts/check-release.mjs --dev`, then `npm run publish-release -- --notes-file <md>`. It publishes to the public `mission-control-releases` repo; the source stays private.

## Files that matter

| File | What |
|---|---|
| `src/renderer/src/components/AgentsView.tsx` | Visible `agent-brief` button (not shell, not exited; disabled while working) |
| `src/renderer/src/app/shortcutActions.ts` | `writeBriefing` guard |
| `src/shared/vibeTime.ts` / `.test.ts` | Time algorithm (15-min gap, merge, hour/day split, streaks) with 8 tests |
| `src/shared/types.ts` | `VibeTime`, `ClaudeTokenStats`, `VibeStats`, `vibeStats()` on the API |
| `src/preload/index.ts` | `vibeStats` → `index:vibeStats` |
| `src/main/indexWorker.ts` | `claudeTokenStats()` and `vibeTimeStats()` SQL |
| `src/main/ipc.ts` | `index:vibeStats` handler (combines Claude stats, time and `codexUsage(0)`) |
| `src/main/codexData.ts` | `readChat` full-file fallback for the last token count |
| `src/renderer/src/components/VibeStatsPanel.tsx` | Tiles, 13 fun facts, `VIBE_HINT` |
| `src/renderer/src/components/HomeView.tsx` | Loads `vibeStats`, header stat and weekly card use clock time |
| `src/renderer/src/home.css` | `.hd-vibe*` styles |
| `src/main/smoke.ts` | `MC_SMOKE_STATS=1` stats tour and screenshot |
| `docs/decisions/0036-exact-vibe-coding-stats.md` | ADR |
| `docs/ROADMAP.md` | "Vibe coding stats (0.30.0)" section, ticked |
| `docs/DEVELOPMENT.md` | Documents `MC_SMOKE_STATS` |
