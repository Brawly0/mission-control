# 0013: Plan limits in the top bar

**Status:** accepted · 2026-10-24

## Context

The user wants to see their Claude plan limits all the time: how much of the 5-hour session and the weekly limit is used, what's left, and when each resets. Since v0.5 the app showed rate-limit meters, but only from `rate_limit_event`s in headless task runs, so for someone who mostly chats interactively they stayed empty.

## Decisions

- **Ask the account directly.** Claude Code's `/usage` reads `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`) with the OAuth access token it saves in `~/.claude/.credentials.json`. `planUsage.ts` does the same: `five_hour`, `seven_day` and (when present) `seven_day_opus` / `seven_day_sonnet` give a 0–100 `utilization` and `resets_at`; `extra_usage` gives pay-as-you-go credits. Parsing is pure (`src/shared/planUsage.ts`) and unit-tested against a real response.
- **Read-only login, never refreshed here.** The credentials file is only read, as the rest of `~/.claude`. If the token has expired we don't refresh it: refreshing rotates the refresh token, and since the app can't write it back, Claude Code would be logged out. Claude Code refreshes it whenever it runs, so we just show the last numbers with "Run any Claude chat once and it refreshes."
- **The token only goes to Anthropic**, the same host Claude Code sends it to. It's never logged, stored or shown.
- **Cadence:** every 3 minutes, plus when the window gets focus (at most every 20 seconds), backing off up to 15 minutes on HTTP 429. It's one small request with no model use, so it doesn't count against the limits it reports. Not polled in smoke runs unless `MC_SMOKE_PLAN=1`.
- **One source of truth.** Account readings and task-run events both go through `setRateLimit` in `tasks.ts`, so the queue's "hold while plan usage is high" guard, Home, Usage and the top bar all see the same numbers.
- **Top bar, not status bar.** The top bar is on every page and has room for two labeled meters with countdowns; the status bar's tiny "Plan 5h N%" item was removed as a duplicate. Under 1280 px the countdowns hide; the tooltip still has everything.
- **Alerts** at a user-set level (default 80%, Settings → Spending, 0 = off) and when a window hits 100%, once per window per reset (`limitAlerted` in the store).

## Pace forecast (v0.14)

- The session window uses the last hour of readings once there are 15 minutes of them (how you're working now). Before that, and for weekly windows, it uses the average since the window started (reset minus 5 hours or 7 days), which already includes nights and breaks. Readings are kept in memory only.
- The meter draws the projected usage at reset as a faint bar. When the window will run out before it resets, the top bar shows "out in …" in place of the reset countdown. A "pace" alert fires once per window when it's due to run out within the hour (session) or day (week).

## Risks

- The endpoint isn't a documented public API; its shape could change. Unknown or missing fields are skipped, and failures keep the last good numbers with the error in the tooltip and on the Usage card.
