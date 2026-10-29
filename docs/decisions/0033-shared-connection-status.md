# 0033: Shared connection diagnostics and compact status

Date: 2026-10-29

The guided-setup and UI-improvement tasks changed connection status independently. Their integration keeps the bounded ReadinessService and application-level useReadiness context as the authoritative source for setup, project diagnostics, the problems center and the compact connection indicator. The indicator expands into the same component used by guided setup, with provider selection available there.

The connection cache retains only timestamp, installed and loggedIn fields, for display continuity. Unavailable checks retain explicitly marked last-known status; cached values never advance setup or resolve problems. One shared five-minute refresh timer replaces independent component polls. Legacy status APIs delegate to the diagnostic service; shell-only smoke scenarios use deterministic IPC fixtures, while onboarding exercises real local CLI processes.

Preserve the newer Home dashboard and Tasks agent workspace during integration. Result-review evidence is recorded when the result is displayed, and changes evidence remains bound to the acknowledged Git snapshot. Terminal navigation alone does not count as inspecting the result.

Cancellation must remove queued diagnostic waiters even when both execution slots are occupied. The regression test holds both slots and cancels forty queued requests, asserting no waiters remain. Native verification covers onboarding plus a separate-process restart, connection retry/staleness, both themes, compact layouts and existing task/review flows.
