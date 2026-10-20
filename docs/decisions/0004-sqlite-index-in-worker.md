# 0004: Search and usage from a SQLite index in a worker thread

**Status:** accepted · 2026-10-20

## Context

Full-text search and usage stats need every message of every chat. Transcripts total hundreds of MB, some single files are over 35 MB, and they grow while agents run. Re-reading them on each search would be slow and would block the main process, which also carries terminal output.

## Decision

- Use Node's built-in `node:sqlite` (Electron 44 / Node 24, SQLite 3.53 with FTS5) instead of `better-sqlite3`, so there's no native module to rebuild for Electron.
- Run indexing and queries in a `worker_threads` worker, bundled through electron-vite's `?modulePath` import.
- Index incrementally by byte offset, because transcripts are append-only JSONL.
- Store per-message usage and compute cost at index time from `pricing.ts`.

## Alternatives rejected

- **Scanning files per search** (ripgrep-style): no ranking, and slow on large histories.
- **A JSON inverted index:** reinvents FTS and has to be loaded fully into memory.
- **`better-sqlite3`:** needs a rebuild for each Electron ABI, which is fragile in the installer.

## Consequences

- The first index of about 120 files took about 4 seconds. Later passes only read new bytes.
- The index can be deleted at any time; it rebuilds from Claude Code's files.
- Prices live in code (`pricing.ts`). Updating them needs a new release, and the UI labels costs as estimates.
