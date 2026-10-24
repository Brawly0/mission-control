# 0016: Plan cost per chat, the "Needs you" inbox and the daily digest

**Status:** accepted · 2026-10-24

## Context

The user is on a Pro plan, so dollar estimates at API prices don't say what matters: how much of the **5-hour and weekly limits** a chat, task or project used. Claude only reports plan usage as one percentage per window (ADR 0013). Plan readings were also kept in memory only, so they were lost on every restart.

Things that wait on the user (agents asking for permission, tasks to review, due dates, limits, budgets, updates) were spread over the sidebar, Tasks, notifications and the status bar.

## Decisions

### Plan readings are saved
- Every successful poll (every 3 minutes) is stored in the index database, table `plan_readings(win, ts, resets_at, util)`. Readings older than 90 days are dropped.
- The table is Mission Control's own data, so it is **not dropped on a schema bump**. A corrupt-database reset still loses it; that's acceptable for history that rebuilds by itself.
- On start, the last 5 hours are read back, so the session forecast keeps its recent pace across a restart.

### Calibration: share of a window per API-priced dollar
- **Pairs of readings** of the same window are matched with the usage the chats logged between them (the `msgs` table). A pair must share the same reset time and be at most 12 hours apart.
- **The currency is API-priced dollars**, which already weigh models (Opus costs more than Haiku) and token kinds (cache reads are cheap). Raw token counts would be dominated by cache reads.
- `share / dollars` summed over the last 14 days gives the rate. A rate needs at least $2 of local usage and a move of 2 points (5 for the session window); until then nothing is shown.
- **Usage elsewhere** (claude.ai, phone, another computer) moves the window without leaving local logs. A move with no local usage in or just before the pair (15 minutes, for the server's rounding and lag) is left out and reported as `outside`. Usage elsewhere that happens at the same time as local usage still inflates the rate a little; the UI says so.
- Readings from the last 5 minutes are skipped, since their replies may not be indexed yet.
- The model-specific weekly windows (`seven_day_opus`, `seven_day_sonnet`) are compared with that model's usage only.
- **Tokens per 1% for each model** are derived from the rate and each model's average price per token. That answers "1% of my week ≈ N tokens on Opus" honestly, without a noisy per-model regression.
- Pure logic in `src/shared/planCost.ts` (unit-tested); SQL in the index worker; caching (10 minutes) in `src/main/planCost.ts`.

### Where it shows
- A `PlanShare` component ("≈0.4% wk") next to costs: chat rows, a project's Overview, task cards and the task drawer, vault builds, and every row on the Usage page. Totals above one window read as "≈2.3 weeks".
- Usage page: "What things cost on your plan": 1% of the week and of a session in dollars, tokens per 1% for the top models, and how much moved outside this computer.
- **Eco check:** chats launched while Eco mode is on are recorded by session id (store `ecoSessions`, newest 1000). Average cost per reply in those chats is compared with other chats over 30 days, once both sides have 30 replies. Per reply, because Eco chats are compacted sooner, so per-chat totals would flatter them.

### "Needs you" inbox
- A new **Inbox** page (sidebar, `Ctrl+Alt+I`) lists, by urgency:
  - agents waiting for input, and agents that finished their turn;
  - finished tasks to review (failures first, with "Mark done" on successes);
  - overdue tasks and tasks due today;
  - plan limits at the alert level, used up, or on pace to run out soon;
  - project budgets at 80% or over;
  - a held queue, a ready update, and agents to restore.
- **Worked out from live state** in the renderer (`src/renderer/src/inbox.ts`, pure and unit-tested), so items go away by themselves when dealt with. No separate event log to keep in sync.
- **Dismissing** stores the item's key in `UiState.inboxDismissed` (newest 300). Keys include what changed (a finish time, a reset, a version), so something new shows again. Live states (an agent asking for permission) can't be dismissed.
- The sidebar badge counts urgent and normal items, orange when something is urgent.

### Daily digest
- Built in the main process (`src/main/digest.ts`) from the index (chats, replies, cost, busiest projects and chats, briefings), the task board and the latest plan numbers. The day's share of the week uses the calibrated rate.
- Shown on the Inbox page (Yesterday / Today), and **once a day as a notification** at a set time (Settings → General, default 09:00, can be turned off). If the app wasn't running at that time, it shows shortly after the next start. Days with nothing to say are skipped. Clicking the notification opens the Inbox.

## Risks

- The rate is an estimate. It shows "≈", explains itself in tooltips, and is hidden until there's enough evidence.
- Anthropic may weigh models or cache reads differently from API prices. A single rate per window then over- or under-states some chats. Per-model windows, where the plan reports them, are calibrated separately.
- The digest notification adds one notification a day; it can be turned off.
