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
