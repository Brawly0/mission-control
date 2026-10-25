# Mission Control: notes for Claude

Electron + React + TypeScript desktop app (Windows) that manages Claude Code projects, sessions, docs and embedded agent terminals.

- Read `docs/ARCHITECTURE.md` before changing structure; `docs/ROADMAP.md` lists what's next.
- Commands: `npm run dev`, `npm run typecheck`, `npm run build`. Smoke test: see `docs/DEVELOPMENT.md`.
- Always run `npm run typecheck && npm run build` after changes.
- Never write to `~/.claude/`. It's read-only for this app. App data goes through `src/main/store.ts`.
- New IPC: `src/shared/types.ts` (MissionControlApi) → `src/preload/index.ts` → handler in `src/main/ipc.ts`.
- Session JSONL files can be 30+ MB: never read a whole file just to list sessions.
- Plain CSS with variables in `src/renderer/src/styles.css`; no UI framework.
- Tick finished items in `docs/ROADMAP.md` and add an ADR in `docs/decisions/` for notable choices.

## Summary instructions

When you compact this conversation, write the summary as a session briefing for whoever picks this up next:
the goal; what's done and verified (and what isn't); decisions made and why; open problems; the exact next
steps; gotchas; and the files that matter.
