# 0029: Reference-led Home dashboard

Date: 2026-10-28

Home follows the supplied dashboard reference: an open greeting with compact activity summary, five launch cards, five colored metric cards, and a three-column grid for provider usage, activity, quick actions, recent projects, tasks and recent activity. Smaller windows use two columns and the existing page scroll. Dark and light themes use scoped Home styles; global navigation and project layouts retain their existing controls.

Claude and Codex launch cards select their named provider explicitly. They use the selected project's folder, or the existing quick-chat folder when no project is selected. New project, task, template, files, run dock, settings and navigation actions reuse existing application paths. Project menus retain pin, new-session and Explorer actions. Tasks offer Open/Agent Teams/All filters and block one-click completion of running work or unfinished teams.

The activity endpoint is typed through MissionControlApi, preload and IPC. It reads the existing SQLite worker index for both providers, without scanning transcripts or changing the index schema. Distinct session/timestamp pairs prevent duplicate streamed entries from inflating activity. Per-day chat counts, event counts and time estimates use local calendar dates; invalid, unlinked and future events are excluded.

AI time is an estimate of active chat intervals, not billing or measured personal work time. Only positive gaps up to 15 minutes count, bounded by the later event's local calendar day. Concurrent sessions can overlap. Labels and tooltips explain this; charts never assign fabricated hours or costs to Codex. Week/month/all-time controls filter the same data and calendar heatmaps offer 30, 90 and 180 days. Loading, empty and retry states remain usable.

Home fetches only while visible, refreshes after indexing and ignores outdated responses. It keeps filter state while deferring chart rendering when hidden. Native SQLite tests cover provider classification, deduplication, idle gaps, date boundaries, malformed/future timestamps and empty history. `MC_SMOKE_HOME=1` verifies the actual UI and provider launch wiring using local CLI fixtures, without model calls.
