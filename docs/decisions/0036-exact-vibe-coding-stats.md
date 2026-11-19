# 0036: Exact vibe coding stats on Home

Date: 2026-11-05

## Context

Users wanted Home to show the tokens they have used with Claude and Codex, how much time they have spent vibe coding, and a few fun facts about their spending, with numbers that are exactly right. The existing "AI time" adds up each chat's active time on its own, so two agents running at once count twice. On one screen it disagreed with any clock-based figure.

## Decision

- **Claude tokens** come from the `msgs` index: one row per API message id, with the largest counts kept across streamed lines. Total = input + cache writes + cache reads + output. Checked against a separate full read of every `~/.claude/projects` file on 2026-11-05: 20,723 message ids, none appearing in more than one file, and identical sums. Dollars are recomputed per model from token counts with the current `pricing.ts`, not taken from costs stored when the index was built. They are labelled as API list-price estimates.
- **Codex tokens** are each rollout's final `total_token_usage`. Codex's `input_tokens` already includes `cached_input_tokens`, and `output_tokens` includes reasoning, so total = input + output; this equals Codex's own `total_tokens` in every file checked. Totals never carry over between rollouts. If the 128 KB tail holds no `token_count` but the file has an unread middle, the whole file is read rather than using the head's older total. No dollar estimate for Codex.
- **Time** (`shared/vibeTime.ts`) uses every prompt and reply of both tools plus every Claude API call (which covers long tool runs). Within one chat, the time between two messages at most 15 minutes apart counts. The spans of all chats are then merged, so overlapping chats count once: the result is wall-clock time. Spans are split at local hour and midnight boundaries for per-day and per-hour figures. "Parallel time" is the per-chat sum minus the merged time.
- Home's header and the weekly time card use this clock time, so the screen never shows two different figures for the same thing. The AI Usage chart keeps its per-chat estimate and keeps its existing label.
- Fun facts only state things computed from these numbers: no word or page conversions.

## Consequences

The weekly time card is lower than before when you run agents in parallel. The time is a definition (message gaps of 15 minutes or less), not keyboard tracking; the hover text says so. `MC_SMOKE_STATS=1` logs the exact figures the app returns and screenshots the panel.

## Stats reconciliation (2026-11-19)

- The index now checks previously indexed source paths. A confirmed missing file invalidates its session's derived rows and offsets, so surviving main/subagent files are reread together. Permission errors do not invalidate data; plan readings are preserved.
- Codex usage now sums changes between timestamped cumulative reports. Date filters and per-day totals use report timestamps; model changes apply to subsequent usage. Repeated totals contribute zero, and signed corrections preserve the final all-time total. Parsed usage is cached by file size and modification time. Reports without timestamps remain in all-time totals under an unknown date, not in dated periods.
- Home explains that Claude API message IDs are deduplicated and chats count sessions with usage. Active days and streaks use local calendar dates across both providers. Claude's own stats can count repeated transcript entries and use UTC dates, so the two displays need not match.
- Verification: regression fixtures cover period boundaries, file modification dates, repeated reports, model changes, appended usage, missing subagents, and permission errors. Independent scans of local Codex reports matched all-time, 7-day and 30-day totals; the built index worker removed stale records from a database snapshot without changing plan readings.
